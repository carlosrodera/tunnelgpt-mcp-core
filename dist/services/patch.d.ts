export declare function applyUnifiedPatch(original: string, patch: string): string;
export declare function createUnifiedDiff(pathLabel: string, before: string, after: string, maxLines?: number): {
    diff: string;
    truncated: boolean;
    changedLines: number;
};
