import type { CanonicalRoot } from "./file-access-config.js";
export declare const DEFAULT_DENY_PATTERNS: readonly string[];
export declare class IgnorePolicy {
    #private;
    constructor(additionalPatterns: readonly string[], dynamicDeniedAbsolutePaths: readonly string[]);
    isHardDenied(root: CanonicalRoot, absolutePath: string, relativePath: string): boolean;
    isIgnored(root: CanonicalRoot, relativePath: string, isDirectory: boolean): Promise<boolean>;
}
