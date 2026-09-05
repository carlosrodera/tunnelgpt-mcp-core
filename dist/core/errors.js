export class TunnelGPTError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "TunnelGPTError";
        this.code = code;
        this.details = details;
    }
}
export function asStructuredError(error) {
    if (error instanceof TunnelGPTError) {
        return {
            ok: false,
            error: error.details === undefined
                ? { code: error.code, message: error.message }
                : { code: error.code, message: error.message, details: error.details },
        };
    }
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal operation failed." } };
}
