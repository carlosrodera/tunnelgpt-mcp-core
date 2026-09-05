import fsSync from "node:fs";
import { IgnorePolicy } from "./ignore-policy.js";
import type { FileAccessConfig, AuthorizedPath, CanonicalRoot } from "./file-access-config.js";
export type ExistingPathKind = "any" | "file" | "directory";
export declare class PathAuthorizer {
    #private;
    readonly ignorePolicy: IgnorePolicy;
    private constructor();
    static create(config: FileAccessConfig): Promise<PathAuthorizer>;
    get roots(): readonly CanonicalRoot[];
    getRoot(alias?: string): CanonicalRoot;
    parsePath(input: string, rootAlias?: string): {
        root: CanonicalRoot;
        relativeInput: string;
        absoluteCandidate: string;
    };
    authorizeExisting(input: string, options?: {
        rootAlias?: string;
        kind?: ExistingPathKind;
        applyIgnore?: boolean;
        maxBytes?: number;
    }): Promise<AuthorizedPath>;
    authorizeNew(input: string, options?: {
        rootAlias?: string;
        applyIgnore?: boolean;
    }): Promise<AuthorizedPath>;
    inspectEntry(input: string, rootAlias?: string): Promise<{
        authorized: AuthorizedPath;
        stat: fsSync.Stats;
        type: string;
    }>;
}
export declare function pathIsWithin(root: string, candidate: string): boolean;
