export type Profile = "read_only" | "edit_safe";
export interface RootConfigInput {
    readonly alias: string;
    readonly path: string;
}
export interface CanonicalRoot {
    readonly alias: string;
    readonly path: string;
    readonly display: string;
}
export interface AuthorizedPath {
    readonly root: CanonicalRoot;
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly displayPath: string;
}
export interface OperationContext {
    readonly signal?: AbortSignal;
    readonly correlationId: string;
}
export interface FileAccessConfig {
    readonly profile: Profile;
    readonly allowedRoots: readonly RootConfigInput[];
    readonly additionalDenyPatterns: readonly string[];
    readonly rejectAllSymlinks: true;
    readonly rejectHardLinks: boolean;
    readonly configFilePath: string;
    readonly logging: {
        readonly directory?: string;
    };
    readonly limits: {
        readonly maxPathLength: number;
        readonly maxWriteBytes: number;
        readonly maxWriteLines: number;
        readonly maxMoveBytes: number;
        readonly confirmationTtlMs: number;
    };
}
