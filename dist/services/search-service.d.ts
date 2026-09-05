import type { PathAuthorizer } from "../core/path-authorizer.js";
import type { AuthorizedPath } from "../core/file-access-config.js";
import type { SafeReader } from "./safe-reader.js";
import type { Walker } from "./walker.js";
export interface TextMatch {
    readonly path: string;
    readonly line: number;
    readonly column: number;
    readonly snippet: string;
    readonly contextBefore: readonly string[];
    readonly contextAfter: readonly string[];
}
export declare class SearchService {
    #private;
    constructor(walker: Walker, authorizer: PathAuthorizer, reader: SafeReader);
    findFiles(start: AuthorizedPath, pattern: string, options: {
        maxResults: number;
        after?: string;
        signal?: AbortSignal;
    }): Promise<{
        paths: string[];
        lastKey?: string;
        hasMore: boolean;
        scanLimitReached: boolean;
    }>;
    searchText(start: AuthorizedPath, query: string, options: {
        glob?: string;
        caseSensitive: boolean;
        maxMatches: number;
        contextLines: number;
        maxFileBytes: number;
        maxOutputBytes: number;
        after?: {
            path: string;
            line: number;
            column: number;
        };
        signal?: AbortSignal;
    }): Promise<{
        matches: TextMatch[];
        last?: {
            path: string;
            line: number;
            column: number;
        };
        hasMore: boolean;
        blockedFiles: number;
        skippedLargeFiles: number;
        scanLimitReached: boolean;
    }>;
}
