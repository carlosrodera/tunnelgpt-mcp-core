import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { TunnelGPTError } from "../core/errors.js";
import { assertNotCancelled } from "../core/operation.js";
import { detectSecretContent } from "../core/secrets.js";
import { applyUnifiedPatch, createUnifiedDiff } from "./patch.js";
function sha256Text(text) {
    return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function validateNewContent(config, text) {
    const bytes = Buffer.byteLength(text, "utf8");
    const lines = text.split(/\r?\n/u).length;
    if (bytes > config.limits.maxWriteBytes || lines > config.limits.maxWriteLines) {
        throw new TunnelGPTError("LIMIT_EXCEEDED", "Proposed content exceeds safe write limits.", {
            bytes,
            lines,
            maxBytes: config.limits.maxWriteBytes,
            maxLines: config.limits.maxWriteLines,
        });
    }
    const detection = detectSecretContent(text);
    if (detection !== undefined) {
        throw new TunnelGPTError("SECRET_CONTENT_BLOCKED", "Writing potential secret content is blocked.", { type: detection.type, line: detection.line });
    }
}
async function fsyncDirectory(directory) {
    try {
        const handle = await fs.open(directory, fsConstants.O_RDONLY);
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    catch {
    }
}
export class AtomicWriter {
    #config;
    #authorizer;
    #reader;
    #confirmations;
    constructor(config, authorizer, reader, confirmations) {
        this.#config = config;
        this.#authorizer = authorizer;
        this.#reader = reader;
        this.#confirmations = confirmations;
    }
    async createTextFile(args, signal) {
        this.#assertEditProfile();
        validateNewContent(this.#config, args.content);
        const target = await this.#authorizer.authorizeNew(args.path, { rootAlias: args.root });
        const digestInput = { root: target.root.alias, path: target.relativePath, contentHash: sha256Text(args.content) };
        const digest = this.#confirmations.queryDigest(digestInput);
        if (args.confirmationToken === undefined || args.confirmed !== true) {
            return {
                ok: true,
                applied: false,
                requiresConfirmation: true,
                confirmationToken: this.#confirmations.encode("create_text_file", digest, { target: target.displayPath }, this.#config.limits.confirmationTtlMs),
                newHash: sha256Text(args.content),
                newBytes: Buffer.byteLength(args.content, "utf8"),
                summary: `Create ${target.displayPath} (${Buffer.byteLength(args.content, "utf8")} bytes).`,
            };
        }
        this.#confirmations.decode(args.confirmationToken, "create_text_file", digest);
        const revalidated = await this.#authorizer.authorizeNew(args.path, { rootAlias: args.root });
        await this.#atomicCreate(revalidated, args.content, signal);
        return {
            ok: true,
            applied: true,
            path: revalidated.displayPath,
            newHash: sha256Text(args.content),
            newBytes: Buffer.byteLength(args.content, "utf8"),
            summary: `Created ${revalidated.displayPath}.`,
        };
    }
    async replaceTextRange(args, signal) {
        this.#assertEditProfile();
        if (!Number.isSafeInteger(args.startLine) || !Number.isSafeInteger(args.endLine) || args.startLine < 1 || args.endLine < args.startLine) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "Line range is invalid.");
        }
        const file = await this.#authorizer.authorizeExisting(args.path, {
            rootAlias: args.root,
            kind: "file",
            maxBytes: this.#config.limits.maxWriteBytes,
        });
        const current = await this.#reader.readForMutation(file, this.#config.limits.maxWriteBytes, signal);
        if (current.sha256 !== args.expectedHash) {
            throw new TunnelGPTError("PRECONDITION_FAILED", "expectedHash does not match the current file.", { currentHash: current.sha256 });
        }
        const lineEnding = current.text.includes("\r\n") ? "\r\n" : "\n";
        const hadFinalNewline = current.text.endsWith("\n");
        const lines = current.text.replace(/\r\n/gu, "\n").split("\n");
        if (hadFinalNewline)
            lines.pop();
        if (args.startLine > lines.length + 1 || args.endLine > lines.length) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "Line range exceeds the current file.");
        }
        const replacementLines = args.replacement.replace(/\r\n/gu, "\n").split("\n");
        if (replacementLines.length === 1 && replacementLines[0] === "")
            replacementLines.length = 0;
        lines.splice(args.startLine - 1, args.endLine - args.startLine + 1, ...replacementLines);
        const updated = `${lines.join(lineEnding)}${hadFinalNewline ? lineEnding : ""}`;
        return this.#previewOrApplyExisting("replace_text_range", file, current.text, updated, args.expectedHash, {
            root: file.root.alias,
            path: file.relativePath,
            startLine: args.startLine,
            endLine: args.endLine,
            replacementHash: sha256Text(args.replacement),
        }, current.containsSecret, args.confirmationToken, args.confirmed, signal);
    }
    async applyPatch(args, signal) {
        this.#assertEditProfile();
        const file = await this.#authorizer.authorizeExisting(args.path, {
            rootAlias: args.root,
            kind: "file",
            maxBytes: this.#config.limits.maxWriteBytes,
        });
        const current = await this.#reader.readForMutation(file, this.#config.limits.maxWriteBytes, signal);
        if (current.sha256 !== args.expectedHash) {
            throw new TunnelGPTError("PRECONDITION_FAILED", "expectedHash does not match the current file.", { currentHash: current.sha256 });
        }
        const updated = applyUnifiedPatch(current.text, args.patch);
        return this.#previewOrApplyExisting("apply_patch", file, current.text, updated, args.expectedHash, {
            root: file.root.alias,
            path: file.relativePath,
            patchHash: sha256Text(args.patch),
        }, current.containsSecret, args.confirmationToken, args.confirmed, signal);
    }
    async createDirectory(args) {
        this.#assertEditProfile();
        const target = await this.#authorizer.authorizeNew(args.path, { rootAlias: args.root });
        const digest = this.#confirmations.queryDigest({ root: target.root.alias, path: target.relativePath });
        if (args.confirmationToken === undefined || args.confirmed !== true) {
            return {
                ok: true,
                applied: false,
                requiresConfirmation: true,
                confirmationToken: this.#confirmations.encode("create_directory", digest, { target: target.displayPath }, this.#config.limits.confirmationTtlMs),
                summary: `Create directory ${target.displayPath}.`,
            };
        }
        this.#confirmations.decode(args.confirmationToken, "create_directory", digest);
        const revalidated = await this.#authorizer.authorizeNew(args.path, { rootAlias: args.root });
        await fs.mkdir(revalidated.absolutePath, { recursive: false, mode: 0o755 });
        await fsyncDirectory(path.dirname(revalidated.absolutePath));
        return { ok: true, applied: true, path: revalidated.displayPath, summary: `Created directory ${revalidated.displayPath}.` };
    }
    async movePath(args, signal) {
        this.#assertEditProfile();
        const source = await this.#authorizer.authorizeExisting(args.source, { rootAlias: args.root, kind: "file" });
        const destination = await this.#authorizer.authorizeNew(args.destination, { rootAlias: source.root.alias });
        if (source.root.alias !== destination.root.alias)
            throw new TunnelGPTError("PATH_OUTSIDE_ROOT", "Moves between authorized roots are denied.");
        const snapshot = await this.#snapshotPath(source, signal);
        if (args.expectedHash !== undefined && snapshot !== args.expectedHash) {
            throw new TunnelGPTError("PRECONDITION_FAILED", "expectedHash does not match the current source.");
        }
        const digestInput = { root: source.root.alias, source: source.relativePath, destination: destination.relativePath, expectedHash: snapshot };
        const digest = this.#confirmations.queryDigest(digestInput);
        if (args.confirmationToken === undefined || args.confirmed !== true) {
            return {
                ok: true,
                applied: false,
                requiresConfirmation: true,
                confirmationToken: this.#confirmations.encode("move_path", digest, { source: source.displayPath, destination: destination.displayPath, expectedHash: snapshot }, this.#config.limits.confirmationTtlMs),
                expectedHash: snapshot,
                summary: `Move ${source.displayPath} to ${destination.displayPath}. Reuse expectedHash and the confirmation token in the confirmed call.`,
            };
        }
        if (args.expectedHash === undefined) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "expectedHash returned by the preview is required for the confirmed move.");
        }
        this.#confirmations.decode(args.confirmationToken, "move_path", digest);
        const sourceAgain = await this.#authorizer.authorizeExisting(args.source, { rootAlias: source.root.alias, kind: "file" });
        const destinationAgain = await this.#authorizer.authorizeNew(args.destination, { rootAlias: source.root.alias });
        const snapshotAgain = await this.#snapshotPath(sourceAgain, signal);
        if (snapshotAgain !== args.expectedHash)
            throw new TunnelGPTError("PRECONDITION_FAILED", "Source changed after preview.");
        await this.#moveRegularFileNoClobber(sourceAgain, destinationAgain, args.expectedHash, signal);
        return {
            ok: true,
            applied: true,
            path: destinationAgain.displayPath,
            previousHash: snapshotAgain,
            summary: `Moved ${sourceAgain.displayPath} to ${destinationAgain.displayPath}.`,
        };
    }
    async #previewOrApplyExisting(operation, file, before, after, expectedHash, digestInput, redactPreimage, confirmationToken, confirmed, signal) {
        validateNewContent(this.#config, after);
        const newHash = sha256Text(after);
        const diff = redactPreimage ? undefined : createUnifiedDiff(file.relativePath, before, after);
        const digest = this.#confirmations.queryDigest({ ...digestInput, expectedHash, newHash });
        if (confirmationToken === undefined || confirmed !== true) {
            return {
                ok: true,
                applied: false,
                requiresConfirmation: true,
                confirmationToken: this.#confirmations.encode(operation, digest, { path: file.displayPath, expectedHash, newHash, newBytes: Buffer.byteLength(after, "utf8") }, this.#config.limits.confirmationTtlMs),
                expectedHash,
                newHash,
                newBytes: Buffer.byteLength(after, "utf8"),
                ...(diff === undefined ? {} : {
                    diff: diff.diff,
                    diffTruncated: diff.truncated,
                    changedLines: diff.changedLines,
                }),
                summary: redactPreimage
                    ? `Preview only for ${file.displayPath}; sensitive preimage omitted and no write has occurred.`
                    : `Preview only for ${file.displayPath}; no write has occurred.`,
            };
        }
        this.#confirmations.decode(confirmationToken, operation, digest);
        const current = await this.#authorizer.authorizeExisting(file.relativePath, {
            rootAlias: file.root.alias,
            kind: "file",
            maxBytes: this.#config.limits.maxWriteBytes,
        });
        const currentHash = await this.#reader.sha256(current, signal);
        if (currentHash !== expectedHash)
            throw new TunnelGPTError("PRECONDITION_FAILED", "File changed after preview; write was rejected.");
        await this.#atomicReplace(current, after, expectedHash, signal);
        return {
            ok: true,
            applied: true,
            path: current.displayPath,
            previousHash: expectedHash,
            newHash,
            newBytes: Buffer.byteLength(after, "utf8"),
            ...(diff === undefined ? {} : {
                diff: diff.diff,
                diffTruncated: diff.truncated,
                changedLines: diff.changedLines,
            }),
            summary: redactPreimage
                ? `Updated ${current.displayPath} atomically; sensitive preimage omitted.`
                : `Updated ${current.displayPath} atomically.`,
        };
    }
    async #atomicCreate(target, content, signal) {
        assertNotCancelled(signal);
        const directory = path.dirname(target.absolutePath);
        const nonce = crypto.randomBytes(12).toString("hex");
        const tempPath = path.join(directory, `.tunnelgpt-tmp-${nonce}`);
        let tempCreated = false;
        let targetLinked = false;
        let identity;
        try {
            const handle = await fs.open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o644);
            tempCreated = true;
            try {
                await handle.writeFile(content, "utf8");
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            assertNotCancelled(signal);
            const tempStat = await fs.lstat(tempPath);
            if (!tempStat.isFile() || tempStat.isSymbolicLink()) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "Temporary create file changed before publication.");
            }
            identity = { dev: tempStat.dev, ino: tempStat.ino };
            await fs.link(tempPath, target.absolutePath);
            targetLinked = true;
            const targetStat = await fs.lstat(target.absolutePath);
            if (!targetStat.isFile() || targetStat.isSymbolicLink()
                || targetStat.dev !== identity.dev || targetStat.ino !== identity.ino) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "Created target identity could not be verified.");
            }
            await fs.unlink(tempPath);
            tempCreated = false;
            targetLinked = false;
            await fsyncDirectory(directory);
        }
        catch (error) {
            if (targetLinked && identity !== undefined) {
                try {
                    const stat = await fs.lstat(target.absolutePath);
                    if (stat.dev === identity.dev && stat.ino === identity.ino)
                        await fs.unlink(target.absolutePath);
                }
                catch {
                }
            }
            if (error.code === "EEXIST") {
                throw new TunnelGPTError("CONFLICT", "Target path already exists.");
            }
            throw error;
        }
        finally {
            if (tempCreated)
                await fs.unlink(tempPath).catch(() => undefined);
        }
    }
    async #atomicReplace(target, content, expectedHash, signal) {
        assertNotCancelled(signal);
        const directory = path.dirname(target.absolutePath);
        const nonce = crypto.randomBytes(12).toString("hex");
        const tempPath = path.join(directory, `.tunnelgpt-tmp-${nonce}`);
        const backupPath = path.join(directory, `.tunnelgpt-backup-${nonce}`);
        const originalStat = await fs.lstat(target.absolutePath);
        if (!originalStat.isFile() || originalStat.isSymbolicLink())
            throw new TunnelGPTError("TYPE_MISMATCH", "Write target is no longer a regular file.");
        let tempCreated = false;
        let backupCreated = false;
        let replacementCommitted = false;
        let preserveBackup = false;
        try {
            const temp = await fs.open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), originalStat.mode & 0o777);
            tempCreated = true;
            try {
                await temp.writeFile(content, "utf8");
                await temp.sync();
            }
            finally {
                await temp.close();
            }
            assertNotCancelled(signal);
            const source = await fs.open(target.absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
            let backup;
            try {
                backup = await fs.open(backupPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), originalStat.mode & 0o777);
                backupCreated = true;
                const sourceHash = crypto.createHash("sha256");
                const before = await source.stat();
                if (!before.isFile() || before.dev !== originalStat.dev || before.ino !== originalStat.ino) {
                    throw new TunnelGPTError("PRECONDITION_FAILED", "Write target changed before backup creation.");
                }
                const buffer = Buffer.allocUnsafe(64 * 1024);
                let position = 0;
                while (true) {
                    assertNotCancelled(signal);
                    const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
                    if (bytesRead === 0)
                        break;
                    const chunk = buffer.subarray(0, bytesRead);
                    sourceHash.update(chunk);
                    await backup.write(chunk);
                    position += bytesRead;
                }
                const after = await source.stat();
                if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
                    throw new TunnelGPTError("PRECONDITION_FAILED", "Write target changed while the backup was created.");
                }
                if (sourceHash.digest("hex") !== expectedHash) {
                    throw new TunnelGPTError("PRECONDITION_FAILED", "Write target content changed before commit.");
                }
                await backup.sync();
            }
            finally {
                await Promise.allSettled([source.close(), ...(backup === undefined ? [] : [backup.close()])]);
            }
            assertNotCancelled(signal);
            const immediatelyBeforeRename = await fs.lstat(target.absolutePath);
            if (!immediatelyBeforeRename.isFile() || immediatelyBeforeRename.isSymbolicLink()
                || immediatelyBeforeRename.dev !== originalStat.dev || immediatelyBeforeRename.ino !== originalStat.ino
                || immediatelyBeforeRename.size !== originalStat.size || immediatelyBeforeRename.mtimeMs !== originalStat.mtimeMs) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "Write target changed immediately before commit.");
            }
            const currentHash = await this.#reader.sha256(target, signal);
            if (currentHash !== expectedHash)
                throw new TunnelGPTError("PRECONDITION_FAILED", "Write target changed immediately before commit.");
            await fs.rename(tempPath, target.absolutePath);
            tempCreated = false;
            replacementCommitted = true;
            await fsyncDirectory(directory);
            await fs.unlink(backupPath);
            backupCreated = false;
        }
        catch (error) {
            if (backupCreated && replacementCommitted) {
                try {
                    await fs.rename(backupPath, target.absolutePath);
                    backupCreated = false;
                    await fsyncDirectory(directory);
                }
                catch {
                    preserveBackup = true;
                }
            }
            throw error;
        }
        finally {
            if (tempCreated)
                await fs.unlink(tempPath).catch(() => undefined);
            if (backupCreated && !preserveBackup)
                await fs.unlink(backupPath).catch(() => undefined);
        }
    }
    async #snapshotPath(target, signal) {
        const stat = await fs.lstat(target.absolutePath);
        if (stat.isSymbolicLink())
            throw new TunnelGPTError("SYMLINK_DENIED", "Symlink source is denied.");
        if (!stat.isFile())
            throw new TunnelGPTError("TYPE_MISMATCH", "move_path supports regular files only in this release.");
        if (stat.size > this.#config.limits.maxMoveBytes)
            throw new TunnelGPTError("LIMIT_EXCEEDED", "Source exceeds move size limit.");
        return this.#reader.sha256(target, signal);
    }
    async #moveRegularFileNoClobber(source, destination, expectedHash, signal) {
        assertNotCancelled(signal);
        let linked = false;
        let linkedIdentity;
        try {
            await fs.link(source.absolutePath, destination.absolutePath);
            linked = true;
            const [sourceStat, destinationStat] = await Promise.all([fs.lstat(source.absolutePath), fs.lstat(destination.absolutePath)]);
            if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !destinationStat.isFile() || destinationStat.isSymbolicLink()
                || sourceStat.dev !== destinationStat.dev || sourceStat.ino !== destinationStat.ino) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "Move source or destination changed during the no-clobber link step.");
            }
            linkedIdentity = { dev: destinationStat.dev, ino: destinationStat.ino };
            const destinationHash = await this.#reader.sha256(destination, signal);
            if (destinationHash !== expectedHash)
                throw new TunnelGPTError("PRECONDITION_FAILED", "Source content changed during move.");
            const immediatelyBeforeUnlink = await fs.lstat(source.absolutePath);
            if (!immediatelyBeforeUnlink.isFile() || immediatelyBeforeUnlink.isSymbolicLink()
                || immediatelyBeforeUnlink.dev !== linkedIdentity.dev || immediatelyBeforeUnlink.ino !== linkedIdentity.ino) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "Move source changed immediately before commit.");
            }
            await fs.unlink(source.absolutePath);
            linked = false;
            await fsyncDirectory(path.dirname(source.absolutePath));
            if (path.dirname(source.absolutePath) !== path.dirname(destination.absolutePath)) {
                await fsyncDirectory(path.dirname(destination.absolutePath));
            }
        }
        catch (error) {
            if (linked && linkedIdentity !== undefined) {
                try {
                    const stat = await fs.lstat(destination.absolutePath);
                    if (stat.dev === linkedIdentity.dev && stat.ino === linkedIdentity.ino)
                        await fs.unlink(destination.absolutePath);
                }
                catch {
                }
            }
            if (error.code === "EEXIST")
                throw new TunnelGPTError("CONFLICT", "Destination already exists.");
            if (error.code === "EXDEV")
                throw new TunnelGPTError("CONFLICT", "Move crosses filesystem boundaries and is denied.");
            throw error;
        }
    }
    #assertEditProfile() {
        if (this.#config.profile !== "edit_safe")
            throw new TunnelGPTError("PROFILE_READ_ONLY", "Write tools are unavailable in read_only profile.");
    }
}
