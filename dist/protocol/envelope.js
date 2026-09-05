export const LDCH_META_PREFIX = "io.ldch/";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const TRACE_KEYS = ["traceparent", "tracestate", "baggage"];
const RESERVED_PREFIX = /^[a-z0-9-]+\.(?:modelcontextprotocol|mcp)(?:\.[a-z0-9-]+)*\//iu;
const INVALID_PARAMS = -32602;
const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export function validateEnvelope(params, options) {
    for (const key of options.emitKeys ?? []) {
        if (RESERVED_PREFIX.test(key)) {
            throw new Error(`refusing to emit "${key}": that metadata prefix is reserved by the specification`);
        }
    }
    const meta = params?._meta;
    if (meta === undefined || meta === null || typeof meta !== "object") {
        return { ok: false, code: INVALID_PARAMS, httpStatus: 400, message: "request _meta is required" };
    }
    const protocolVersion = meta[PROTOCOL_VERSION_KEY];
    if (typeof protocolVersion !== "string" || protocolVersion.length === 0) {
        return { ok: false, code: INVALID_PARAMS, httpStatus: 400, message: `${PROTOCOL_VERSION_KEY} is required` };
    }
    const clientCapabilities = meta[CLIENT_CAPABILITIES_KEY];
    if (clientCapabilities === undefined || clientCapabilities === null || typeof clientCapabilities !== "object") {
        return { ok: false, code: INVALID_PARAMS, httpStatus: 400, message: `${CLIENT_CAPABILITIES_KEY} is required` };
    }
    let clientInfo;
    const rawClientInfo = meta[CLIENT_INFO_KEY];
    if (rawClientInfo !== undefined) {
        if (rawClientInfo === null || typeof rawClientInfo !== "object" || Array.isArray(rawClientInfo)) {
            return { ok: false, code: INVALID_PARAMS, httpStatus: 400, message: `${CLIENT_INFO_KEY} must be an object when present` };
        }
        clientInfo = rawClientInfo;
    }
    const declared = new Set(Object.keys(clientCapabilities));
    const missing = options.requiredCapabilities.filter((c) => !declared.has(c));
    if (missing.length > 0) {
        return {
            ok: false,
            code: MISSING_REQUIRED_CLIENT_CAPABILITY,
            httpStatus: 400,
            message: "the request requires a client capability it did not declare",
            data: { requiredCapabilities: missing },
        };
    }
    const traceContext = {};
    for (const key of TRACE_KEYS) {
        const value = meta[key];
        if (typeof value === "string")
            traceContext[key] = value;
    }
    return {
        ok: true,
        protocolVersion,
        clientCapabilities: clientCapabilities,
        ...(clientInfo ? { clientInfo } : {}),
        ...(Object.keys(traceContext).length > 0 ? { traceContext } : {}),
    };
}
