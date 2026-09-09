export declare function normalizeRelativePath(value: string): string;
export declare function globToRegExp(patternInput: string, options?: {
    anchored?: boolean;
    basename?: boolean;
}): RegExp;
export declare function matchesGlob(relativePath: string, pattern: string): boolean;
