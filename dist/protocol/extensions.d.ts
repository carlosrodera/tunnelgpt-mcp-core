export declare const SUPPORTED_EXTENSIONS: readonly ["io.modelcontextprotocol/tasks"];
export declare const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
export declare const JOB_CONTRACT_FALLBACK = "io.ldch/job-contract";
export interface NegotiationResult {
    readonly granted: readonly string[];
    readonly declined: readonly string[];
    readonly fallback: readonly string[];
}
export declare function negotiateExtensions(requested?: readonly string[]): NegotiationResult;
export declare class ExtensionNotNegotiatedError extends Error {
    readonly extension: string;
    constructor(extension: string);
}
export declare function assertExtensionUsable(extension: string, negotiation: NegotiationResult): void;
