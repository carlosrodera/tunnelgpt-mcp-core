import type { AuthorizedPath } from "../core/file-access-config.js";
import type { PathAuthorizer } from "../core/path-authorizer.js";
export interface WalkEntry {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly displayPath: string;
    readonly name: string;
    readonly type: "file" | "directory";
    readonly size: number;
    readonly mtimeMs: number;
    readonly depth: number;
}
export interface WalkOptions {
    readonly maxDepth: number;
    readonly includeHidden: boolean;
    readonly scanBudget: number;
    readonly signal?: AbortSignal;
}
export declare class Walker {
    #private;
    constructor(authorizer: PathAuthorizer);
    collect(start: AuthorizedPath, options: WalkOptions): Promise<{
        entries: WalkEntry[];
        scanLimitReached: boolean;
    }>;
}
