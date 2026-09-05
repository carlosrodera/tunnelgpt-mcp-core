export const SUPPORTED_EXTENSIONS = Object.freeze(["io.modelcontextprotocol/tasks"] as const);
export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
export const JOB_CONTRACT_FALLBACK = "io.ldch/job-contract";
export interface NegotiationResult {
    readonly granted: readonly string[];
    readonly declined: readonly string[];
    readonly fallback: readonly string[];
}
export function negotiateExtensions(requested: readonly string[] = []): NegotiationResult {
    const supported = new Set<string>(SUPPORTED_EXTENSIONS);
    const asked = [...new Set(requested)];
    const granted = asked.filter((e) => supported.has(e));
    const declined = asked.filter((e) => !supported.has(e));
    return {
        granted,
        declined,
        fallback: granted.includes(TASKS_EXTENSION) ? [] : [JOB_CONTRACT_FALLBACK],
    };
}
export class ExtensionNotNegotiatedError extends Error {
    public constructor(public readonly extension: string) {
        super(`${extension} was not negotiated; use ${JOB_CONTRACT_FALLBACK} for dependent long operations`);
        this.name = "ExtensionNotNegotiatedError";
    }
}
export function assertExtensionUsable(extension: string, negotiation: NegotiationResult): void {
    if (!negotiation.granted.includes(extension))
        throw new ExtensionNotNegotiatedError(extension);
}
