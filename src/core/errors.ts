export type ErrorCode = "INVALID_ARGUMENT" | "ROOT_NOT_ALLOWED" | "PATH_OUTSIDE_ROOT" | "PATH_TRAVERSAL" | "PATH_DENIED" | "SYMLINK_DENIED" | "HARDLINK_DENIED" | "SPECIAL_FILE_DENIED" | "NOT_FOUND" | "TYPE_MISMATCH" | "BINARY_FILE" | "UNSUPPORTED_ENCODING" | "SECRET_CONTENT_BLOCKED" | "LIMIT_EXCEEDED" | "CURSOR_INVALID" | "CURSOR_EXPIRED" | "PROFILE_READ_ONLY" | "PRECONDITION_FAILED" | "CONFIRMATION_REQUIRED" | "CONFIRMATION_INVALID" | "CONFLICT" | "TIMEOUT" | "CANCELLED" | "GIT_UNAVAILABLE" | "GIT_ERROR" | "DESCRIPTOR_NON_CANONICAL" | "DESCRIPTOR_SCHEMA_UNSUPPORTED" | "DESCRIPTOR_ENVELOPE_INVALID" | "DESCRIPTOR_KEY_UNAVAILABLE" | "DESCRIPTOR_KEY_UNKNOWN_VERSION" | "DESCRIPTOR_RESOLUTION_DENIED" | "DESCRIPTOR_NOT_FOUND" | "DESCRIPTOR_DIGEST_MISMATCH" | "WORKER_LOCK_HELD" | "WORKER_UNAVAILABLE" | "EXECUTION_GRANT_REQUIRED" | "SERVICE_PERIOD_ENDED" | "INTERNAL_ERROR";
export class TunnelGPTError extends Error {
    public readonly code: ErrorCode;
    public readonly details?: Readonly<Record<string, unknown>>;
    public constructor(code: ErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
        super(message);
        this.name = "TunnelGPTError";
        this.code = code;
        this.details = details;
    }
}
export function asStructuredError(error: unknown): {
    ok: false;
    error: {
        code: ErrorCode;
        message: string;
        details?: Readonly<Record<string, unknown>>;
    };
} {
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
