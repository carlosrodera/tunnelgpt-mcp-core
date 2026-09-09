import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { TunnelGPTError } from "../core/errors.js";
import { assertNotCancelled } from "../core/operation.js";
import { detectSecretContent } from "../core/secrets.js";
function identityOf(stat) {
    return {
        dev: BigInt(stat.dev),
        ino: BigInt(stat.ino),
        size: BigInt(stat.size),
        mtimeNs: "mtimeNs" in stat ? stat.mtimeNs : BigInt(Math.trunc(stat.mtimeMs * 1000000)),
    };
}
function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs;
}
function checkBinary(buffer) {
    if (buffer.includes(0))
        throw new TunnelGPTError("BINARY_FILE", "Binary file content is not readable as text.");
    let suspicious = 0;
    for (const byte of buffer) {
        if (byte < 9 || (byte > 13 && byte < 32))
            suspicious += 1;
    }
    if (buffer.length > 0 && suspicious / buffer.length > 0.02) {
        throw new TunnelGPTError("BINARY_FILE", "File appears to be binary.");
    }
}
function countUtf8Bytes(value) {
    return Buffer.byteLength(value, "utf8");
}
export class SafeReader {
    async readText(authorized, request) {
        const startColumn = request.startColumn ?? 1;
        if (!Number.isSafeInteger(request.startLine) || request.startLine < 1
            || !Number.isSafeInteger(startColumn) || startColumn < 1
            || !Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1
            || (request.endLine !== undefined && (!Number.isSafeInteger(request.endLine) || request.endLine < request.startLine))) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "Use positive line, column and byte limits in an ordered range.");
        }
        let handle;
        try {
            handle = await fs.open(authorized.absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
        }
        catch (error) {
            throw new TunnelGPTError(error.code === "ELOOP" ? "SYMLINK_DENIED" : "NOT_FOUND", "File cannot be opened safely.");
        }
        try {
            const stat = await handle.stat({ bigint: true });
            if (!stat.isFile())
                throw new TunnelGPTError("SPECIAL_FILE_DENIED", "Only regular files can be read.");
            const before = identityOf(stat);
            const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
            const hash = crypto.createHash("sha256"), chunk = Buffer.allocUnsafe(65536);
            const selected = [];
            let position = 0, line = 1, column = 1, outputBytes = 0, totalLines = 0;
            let sawLf = false, sawCrlf = false, pendingCr = false, scanTail = "";
            let next;
            let containsSecret = false;
            const inRange = () => line >= request.startLine && (request.endLine === undefined || line <= request.endLine)
                && (line !== request.startLine || column >= startColumn);
            const append = (value) => {
                if (!inRange() || next !== undefined)
                    return;
                let entry = selected[selected.length - 1];
                const fresh = entry?.line !== line;
                const bytes = countUtf8Bytes(value) + (fresh ? countUtf8Bytes(`${line}: `) + (selected.length ? 1 : 0) : 0);
                if (outputBytes + bytes > request.maxBytes) {
                    next = { line, column };
                    return;
                }
                if (fresh) {
                    entry = { line, text: "" };
                    selected.push(entry);
                }
                entry.text += value;
                outputBytes += bytes;
            };
            const consume = (text) => {
                // Bounded overlap catches credential markers spanning chunks/pages. Scan
                // before returning any fragment, including bytes outside the requested page.
                const window = scanTail + text;
                containsSecret ||= detectSecretContent(window) !== undefined;
                scanTail = window.slice(-8192);
                for (const char of text) {
                    if (pendingCr) {
                        if (char !== "\n") {
                            append("\r");
                            column++;
                        }
                        pendingCr = false;
                    }
                    if (char === "\r") {
                        pendingCr = true;
                        continue;
                    }
                    if (char === "\n") {
                        // Empty lines have a visible numbered entry, too.
                        if (column === 1)
                            append("");
                        totalLines = line;
                        line++;
                        column = 1;
                    }
                    else {
                        append(char);
                        column++;
                        totalLines = line;
                    }
                }
            };
            let lastCharacter = "";
            for (;;) {
                assertNotCancelled(request.signal);
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
                if (!bytesRead)
                    break;
                const bytes = chunk.subarray(0, bytesRead);
                position += bytesRead;
                hash.update(bytes);
                checkBinary(bytes);
                let decoded;
                try {
                    decoded = decoder.decode(bytes, { stream: true });
                }
                catch {
                    throw new TunnelGPTError("UNSUPPORTED_ENCODING", "File is not valid UTF-8.");
                }
                const endings = lastCharacter + decoded;
                sawCrlf ||= endings.includes("\r\n");
                sawLf ||= /(?:^|[^\r])\n/u.test(endings);
                lastCharacter = decoded.slice(-1) || lastCharacter;
                consume(decoded);
            }
            try {
                consume(decoder.decode());
            }
            catch (error) {
                if (error instanceof TunnelGPTError)
                    throw error;
                throw new TunnelGPTError("UNSUPPORTED_ENCODING", "File is not valid UTF-8.");
            }
            if (pendingCr) {
                append("\r");
                totalLines = line;
            }
            if (!position) {
                append("");
                totalLines = 1;
            }
            if (!sameIdentity(before, identityOf(await handle.stat({ bigint: true })))) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "File changed while it was being read.");
            }
            if (containsSecret)
                throw new TunnelGPTError("SECRET_CONTENT_BLOCKED", "Potential secret content was blocked.");
            if (next && !selected.length)
                throw new TunnelGPTError("LIMIT_EXCEEDED", "Increase maxBytes to fit a line label and one Unicode character.", { minimumBytes: countUtf8Bytes(`${next.line}: `) + 4 });
            const numberedText = selected.map(entry => `${entry.line}: ${entry.text}`).join("\n");
            return {
                path: authorized.displayPath, startLine: selected[0]?.line ?? request.startLine,
                endLine: selected[selected.length - 1]?.line ?? Math.min(totalLines, request.startLine - 1),
                totalLines, numberedText, text: selected.map(entry => entry.text).join("\n"),
                bytesReturned: outputBytes, fileBytes: Number(before.size), sha256: hash.digest("hex"),
                truncated: next !== undefined,
                ...(next ? { nextStartLine: next.line, nextStartColumn: next.column } : {}),
                lineEnding: sawLf && !sawCrlf ? "LF" : sawCrlf && !sawLf ? "CRLF" : "mixed_or_none",
            };
        }
        finally {
            await handle.close();
        }
    }
    async readWholeText(authorized, maxBytes, signal) {
        const result = await this.#readWholeText(authorized, maxBytes, signal);
        if (result.containsSecret) {
            const detection = detectSecretContent(result.text);
            throw new TunnelGPTError("SECRET_CONTENT_BLOCKED", "Potential secret content was blocked.", { type: detection.type, line: detection.line });
        }
        return { text: result.text, sha256: result.sha256, fileBytes: result.fileBytes };
    }
    async readForMutation(authorized, maxBytes, signal) {
        return this.#readWholeText(authorized, maxBytes, signal);
    }
    async #readWholeText(authorized, maxBytes, signal) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "maxBytes must be a positive integer.");
        }
        const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
        let handle;
        try {
            handle = await fs.open(authorized.absolutePath, flags);
        }
        catch (error) {
            const code = error.code;
            if (code === "ELOOP")
                throw new TunnelGPTError("SYMLINK_DENIED", "Symlink was encountered during open.");
            throw new TunnelGPTError("NOT_FOUND", "File cannot be opened safely.");
        }
        try {
            assertNotCancelled(signal);
            const beforeStat = await handle.stat({ bigint: true });
            if (!beforeStat.isFile()) {
                throw new TunnelGPTError("TYPE_MISMATCH", "Mutation preimages must be regular files.");
            }
            const before = identityOf(beforeStat);
            if (before.size > BigInt(maxBytes)) {
                throw new TunnelGPTError("LIMIT_EXCEEDED", "File exceeds the full-read limit.", { fileBytes: Number(before.size), maxBytes });
            }
            const chunks = [];
            let position = 0;
            while (position <= maxBytes) {
                assertNotCancelled(signal);
                const remaining = maxBytes - position + 1;
                const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
                if (bytesRead === 0)
                    break;
                const bytes = chunk.subarray(0, bytesRead);
                checkBinary(bytes);
                chunks.push(bytes);
                position += bytesRead;
            }
            if (position > maxBytes) {
                throw new TunnelGPTError("LIMIT_EXCEEDED", "File exceeds the full-read limit.", { maxBytes });
            }
            const buffer = Buffer.concat(chunks, position);
            assertNotCancelled(signal);
            let text;
            try {
                text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
            }
            catch {
                throw new TunnelGPTError("UNSUPPORTED_ENCODING", "File is not valid UTF-8.");
            }
            const afterStat = await handle.stat({ bigint: true });
            if (!afterStat.isFile()) {
                throw new TunnelGPTError("TYPE_MISMATCH", "Mutation preimages must remain regular files.");
            }
            const after = identityOf(afterStat);
            if (!sameIdentity(before, after))
                throw new TunnelGPTError("PRECONDITION_FAILED", "File changed while it was being read.");
            const detection = detectSecretContent(text);
            return {
                text,
                sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
                fileBytes: buffer.length,
                containsSecret: detection !== undefined,
            };
        }
        finally {
            await handle.close();
        }
    }
    async sha256(authorized, signal) {
        const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
        const handle = await fs.open(authorized.absolutePath, flags);
        try {
            const before = identityOf(await handle.stat({ bigint: true }));
            const hash = crypto.createHash("sha256");
            const chunk = Buffer.allocUnsafe(64 * 1024);
            let position = 0;
            while (true) {
                assertNotCancelled(signal);
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
                if (bytesRead === 0)
                    break;
                position += bytesRead;
                hash.update(chunk.subarray(0, bytesRead));
            }
            const after = identityOf(await handle.stat({ bigint: true }));
            if (!sameIdentity(before, after))
                throw new TunnelGPTError("PRECONDITION_FAILED", "File changed while hashing.");
            return hash.digest("hex");
        }
        finally {
            await handle.close();
        }
    }
}
