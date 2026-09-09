export const SUPPORTED_EXTENSIONS = Object.freeze(["io.modelcontextprotocol/tasks"]);
export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
export const JOB_CONTRACT_FALLBACK = "io.ldch/job-contract";
export function negotiateExtensions(requested = []) {
    const supported = new Set(SUPPORTED_EXTENSIONS);
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
    extension;
    constructor(extension) {
        super(`${extension} was not negotiated; use ${JOB_CONTRACT_FALLBACK} for dependent long operations`);
        this.extension = extension;
        this.name = "ExtensionNotNegotiatedError";
    }
}
export function assertExtensionUsable(extension, negotiation) {
    if (!negotiation.granted.includes(extension))
        throw new ExtensionNotNegotiatedError(extension);
}
