export const RESERVED_JSONRPC_RANGE = { min: -32768, max: -32000 } as const;
export const SPECIFICATION_SUBRANGE = { min: -32099, max: -32020 } as const;
export const RETIRED_CODES: readonly number[] = Object.freeze([-32002, -32042]);
export const LDCH_ERROR_CODES = Object.freeze({
    LDCH_PRINCIPAL_REQUIRED: -41001,
    LDCH_PRINCIPAL_INVALID: -41002,
    LDCH_CONNECTOR_ONLY: -41003,
    LDCH_GRANT_MISSING: -41010,
    LDCH_GRANT_EXPIRED: -41011,
    LDCH_GRANT_REVOKED: -41012,
    LDCH_CAPABILITY_DENIED: -41013,
    LDCH_POLICY_VERSION_STALE: -41014,
    LDCH_HANDLE_INVALID: -41020,
    LDCH_HANDLE_FOREIGN: -41021,
    LDCH_HANDLE_EXPIRED: -41022,
    LDCH_CONFIRMATION_REQUIRED: -41030,
    LDCH_CONFIRMATION_MISMATCH: -41031,
    LDCH_CONFIRMATION_EXPIRED: -41032,
    LDCH_IDEMPOTENCY_CONFLICT: -41040,
    LDCH_RECONCILIATION_REQUIRED: -41041,
    LDCH_SNAPSHOT_STALE: -41050,
    LDCH_CONTRACT_RETIRED: -41051,
    LDCH_BODY_TOO_LARGE: -41060,
    LDCH_RESULT_TOO_LARGE: -41061,
    LDCH_RATE_LIMITED: -41062,
    LDCH_DEADLINE_EXCEEDED: -41063,
    LDCH_SCHEMA_UNSAFE: -41070,
    LDCH_DOWNSTREAM_UNAVAILABLE: -41080,
});
export function assertCodeAllocationValid(codes: Readonly<Record<string, number>>): void {
    for (const [symbol, code] of Object.entries(codes)) {
        if (RETIRED_CODES.includes(code)) {
            throw new Error(`${symbol} uses ${code}, which the current revision retired`);
        }
        if (code >= SPECIFICATION_SUBRANGE.min && code <= SPECIFICATION_SUBRANGE.max) {
            throw new Error(`${symbol} uses ${code}, which is reserved for the specification`);
        }
        if (code >= RESERVED_JSONRPC_RANGE.min && code <= RESERVED_JSONRPC_RANGE.max) {
            throw new Error(`${symbol} uses ${code}, inside the JSON-RPC reserved range`);
        }
    }
}
