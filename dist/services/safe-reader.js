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
        if (!Number.isSafeInteger(request.startLine) || request.startLine < 1) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "startLine must be a positive integer.");
        }
        if (request.endLine !== undefined && (!Number.isSafeInteger(request.endLine) || request.endLine < request.startLine)) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "endLine must be greater than or equal to startLine.");
        }
        if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1) {
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
            const before = identityOf(await handle.stat({ bigint: true }));
            const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
            const hash = crypto.createHash("sha256");
            const chunk = Buffer.allocUnsafe(64 * 1024);
            let position = 0;
            let pending = "";
            let currentLine = 1;
            let totalLines = 0;
            let outputBytes = 0;
            let truncated = false;
            const selected = [];
            let sawLf = false;
            let sawCrlf = false;
            while (true) {
                assertNotCancelled(request.signal);
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
                if (bytesRead === 0)
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
                pending += decoded;
                if (Buffer.byteLength(pending, "utf8") > Math.max(1024 * 1024, request.maxBytes * 4)) {
                    throw new TunnelGPTError("LIMIT_EXCEEDED", "A text line exceeds the safe line-buffer limit.");
                }
                let newlineIndex;
                while ((newlineIndex = pending.indexOf("\n")) !== -1) {
                    const rawLine = pending.slice(0, newlineIndex);
                    pending = pending.slice(newlineIndex + 1);
                    const hadCr = rawLine.endsWith("\r");
                    sawLf = sawLf || !hadCr;
                    sawCrlf = sawCrlf || hadCr;
                    const line = hadCr ? rawLine.slice(0, -1) : rawLine;
                    totalLines = currentLine;
                    if (currentLine >= request.startLine && (request.endLine === undefined || currentLine <= request.endLine)) {
                        const rendered = `${currentLine}: ${line}`;
                        const renderedBytes = countUtf8Bytes(rendered) + (selected.length === 0 ? 0 : 1);
                        if (outputBytes + renderedBytes > request.maxBytes) {
                            if (selected.length === 0) {
                                throw new TunnelGPTError("LIMIT_EXCEEDED", "A requested line exceeds maxBytes; narrow reading cannot safely split a line.", { line: currentLine, maxBytes: request.maxBytes });
                            }
                            truncated = true;
                        }
                        else if (!truncated) {
                            selected.push(rendered);
                            outputBytes += renderedBytes;
                        }
                    }
                    currentLine += 1;
                }
            }
            let finalDecoded;
            try {
                finalDecoded = decoder.decode();
            }
            catch {
                throw new TunnelGPTError("UNSUPPORTED_ENCODING", "File is not valid UTF-8.");
            }
            pending += finalDecoded;
            if (pending.length > 0 || position === 0) {
                totalLines = currentLine;
                if (currentLine >= request.startLine && (request.endLine === undefined || currentLine <= request.endLine)) {
                    const rendered = `${currentLine}: ${pending}`;
                    const renderedBytes = countUtf8Bytes(rendered) + (selected.length === 0 ? 0 : 1);
                    if (outputBytes + renderedBytes > request.maxBytes) {
                        if (selected.length === 0) {
                            throw new TunnelGPTError("LIMIT_EXCEEDED", "A requested line exceeds maxBytes; narrow reading cannot safely split a line.", { line: currentLine, maxBytes: request.maxBytes });
                        }
                        truncated = true;
                    }
                    else if (!truncated) {
                        selected.push(rendered);
                        outputBytes += renderedBytes;
                    }
                }
            }
            else {
                totalLines = Math.max(0, currentLine - 1);
            }
            const after = identityOf(await handle.stat({ bigint: true }));
            if (!sameIdentity(before, after)) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "File changed while it was being read.");
            }
            const numberedText = selected.join("\n");
            const text = selected.map((line) => {
                const separator = line.indexOf(": ");
                return separator === -1 ? line : line.slice(separator + 2);
            }).join("\n");
            const detection = detectSecretContent(numberedText);
            if (detection !== undefined) {
                throw new TunnelGPTError("SECRET_CONTENT_BLOCKED", "Potential secret content was blocked.", {
                    type: detection.type,
                    resultLine: detection.line,
                });
            }
            const lastSelectedLine = selected.length === 0
                ? Math.min(totalLines, request.startLine - 1)
                : Number.parseInt(selected[selected.length - 1].split(":", 1)[0], 10);
            const endedByRequestedRange = request.endLine !== undefined && lastSelectedLine >= request.endLine;
            const hasMore = lastSelectedLine < totalLines && !endedByRequestedRange;
            const actualTruncated = truncated || hasMore;
            return {
                path: authorized.displayPath,
                startLine: selected.length === 0 ? request.startLine : Number.parseInt(selected[0].split(":", 1)[0], 10),
                endLine: lastSelectedLine,
                totalLines,
                numberedText,
                text,
                bytesReturned: outputBytes,
                fileBytes: Number(before.size),
                sha256: hash.digest("hex"),
                truncated: actualTruncated,
                ...(actualTruncated && lastSelectedLine >= request.startLine ? { nextStartLine: lastSelectedLine + 1 } : {}),
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
