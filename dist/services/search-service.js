import { TunnelGPTError } from "../core/errors.js";
import { matchesGlob } from "../core/glob.js";
import { assertNotCancelled } from "../core/operation.js";
export class SearchService {
    #walker;
    #authorizer;
    #reader;
    constructor(walker, authorizer, reader) {
        this.#walker = walker;
        this.#authorizer = authorizer;
        this.#reader = reader;
    }
    async findFiles(start, pattern, options) {
        const scanBudget = Math.max(10000, options.maxResults * 200);
        const walked = await this.#walker.collect(start, { maxDepth: 10, includeHidden: true, scanBudget, signal: options.signal });
        const matched = walked.entries
            .filter((entry) => entry.type === "file" && matchesGlob(entry.relativePath, pattern))
            .filter((entry) => options.after === undefined || entry.relativePath > options.after)
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
        const selected = matched.slice(0, options.maxResults);
        return {
            paths: selected.map((entry) => entry.displayPath),
            ...(selected.length > 0 ? { lastKey: selected[selected.length - 1].relativePath } : {}),
            hasMore: matched.length > selected.length || walked.scanLimitReached,
            scanLimitReached: walked.scanLimitReached,
        };
    }
    async searchText(start, query, options) {
        if (query.length === 0 || query.length > 4096)
            throw new TunnelGPTError("INVALID_ARGUMENT", "query is empty or too long.");
        const walked = await this.#walker.collect(start, {
            maxDepth: 10,
            includeHidden: true,
            scanBudget: Math.max(10000, options.maxMatches * 200),
            signal: options.signal,
        });
        const files = walked.entries
            .filter((entry) => entry.type === "file")
            .filter((entry) => options.glob === undefined || matchesGlob(entry.relativePath, options.glob))
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
        const needle = options.caseSensitive ? query : query.toLocaleLowerCase("en-US");
        const matches = [];
        let blockedFiles = 0;
        let skippedLargeFiles = 0;
        let hasMore = walked.scanLimitReached;
        let outputBytes = 0;
        for (const discovered of files) {
            assertNotCancelled(options.signal);
            if (discovered.size > options.maxFileBytes) {
                skippedLargeFiles += 1;
                continue;
            }
            let text;
            try {
                const file = await this.#authorizer.authorizeExisting(discovered.displayPath, {
                    rootAlias: start.root.alias,
                    kind: "file",
                    maxBytes: options.maxFileBytes,
                });
                text = (await this.#reader.readWholeText(file, options.maxFileBytes, options.signal)).text;
            }
            catch (error) {
                if (error instanceof TunnelGPTError && error.code === "SECRET_CONTENT_BLOCKED")
                    blockedFiles += 1;
                else if (error instanceof TunnelGPTError && error.code === "LIMIT_EXCEEDED")
                    skippedLargeFiles += 1;
                continue;
            }
            const lines = text.split(/\r?\n/u);
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                const line = lines[lineIndex];
                const haystack = options.caseSensitive ? line : line.toLocaleLowerCase("en-US");
                let from = 0;
                while (from <= haystack.length) {
                    const index = haystack.indexOf(needle, from);
                    if (index === -1)
                        break;
                    const marker = { path: discovered.relativePath, line: lineIndex + 1, column: index + 1 };
                    if (options.after !== undefined) {
                        const beforeOrEqual = marker.path < options.after.path ||
                            (marker.path === options.after.path && (marker.line < options.after.line ||
                                (marker.line === options.after.line && marker.column <= options.after.column)));
                        if (beforeOrEqual) {
                            from = index + Math.max(1, needle.length);
                            continue;
                        }
                    }
                    const contextStart = Math.max(0, lineIndex - options.contextLines);
                    const contextEnd = Math.min(lines.length, lineIndex + options.contextLines + 1);
                    const shorten = (value) => value.length <= 2000 ? value : `${value.slice(0, 2000)}…[truncated]`;
                    const safeSnippet = shorten(line);
                    const safeBefore = lines.slice(contextStart, lineIndex).map(shorten);
                    const safeAfter = lines.slice(lineIndex + 1, contextEnd).map(shorten);
                    const estimatedBytes = Buffer.byteLength(discovered.displayPath, "utf8") + Buffer.byteLength(safeSnippet, "utf8") +
                        safeBefore.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0) +
                        safeAfter.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0) + 256;
                    if (outputBytes + estimatedBytes > options.maxOutputBytes) {
                        hasMore = true;
                        const last = matches[matches.length - 1];
                        return {
                            matches,
                            ...(last === undefined ? {} : { last: { path: last.path.replace(`${start.root.alias}:/`, ""), line: last.line, column: last.column } }),
                            hasMore,
                            blockedFiles,
                            skippedLargeFiles,
                            scanLimitReached: walked.scanLimitReached,
                        };
                    }
                    outputBytes += estimatedBytes;
                    matches.push({
                        path: discovered.displayPath,
                        line: lineIndex + 1,
                        column: index + 1,
                        snippet: safeSnippet,
                        contextBefore: safeBefore,
                        contextAfter: safeAfter,
                    });
                    if (matches.length >= options.maxMatches) {
                        const last = matches[matches.length - 1];
                        return {
                            matches,
                            last: { path: last.path.replace(`${start.root.alias}:/`, ""), line: last.line, column: last.column },
                            hasMore: true,
                            blockedFiles,
                            skippedLargeFiles,
                            scanLimitReached: walked.scanLimitReached,
                        };
                    }
                    from = index + Math.max(1, needle.length);
                }
            }
        }
        const lastMatch = matches[matches.length - 1];
        return {
            matches,
            ...(lastMatch === undefined ? {} : {
                last: {
                    path: lastMatch.path.replace(`${start.root.alias}:/`, ""),
                    line: lastMatch.line,
                    column: lastMatch.column,
                },
            }),
            hasMore,
            blockedFiles,
            skippedLargeFiles,
            scanLimitReached: walked.scanLimitReached,
        };
    }
}
