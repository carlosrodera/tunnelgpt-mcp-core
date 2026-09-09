export const LEGACY_WIRE_ERA = "2025-11-25";
export function buildLegacyRequestContext(request) {
    return { era: LEGACY_WIRE_ERA, method: request.method, params: { ...(request.params ?? {}) } };
}
const SERVE = Object.freeze({ kind: "serve" });
const IGNORED_HEADERS = ["mcp-session-id", "last-event-id"];
function lookup(headers, name) {
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === wanted)
            return value;
    }
    return undefined;
}
export function classifyRemovedAffordance(input) {
    const headers = input.headers ?? {};
    if (lookup(headers, "origin") !== undefined) {
        return { kind: "refuse", httpStatus: 403, code: -32000, message: "origin is not allowed on the local transport" };
    }
    if (input.httpMethod.toUpperCase() !== "POST") {
        return { kind: "refuse", httpStatus: 405, code: -32000, message: `${input.httpMethod} is not allowed on the rpc endpoint` };
    }
    return SERVE;
}
export function ignoredHeaderNames() {
    return IGNORED_HEADERS;
}
export class LegacyClientRegistry {
    #active = new Map();
    attach(legacyId, clientId) {
        const holder = this.#active.get(legacyId);
        if (holder !== undefined && holder !== clientId) {
            return { ok: false, reason: "ANOTHER_CLIENT_IS_ACTIVE", activeClientId: holder };
        }
        this.#active.set(legacyId, clientId);
        return { ok: true, clientId };
    }
    detach(legacyId, clientId) {
        if (this.#active.get(legacyId) === clientId)
            this.#active.delete(legacyId);
    }
    activeClient(legacyId) {
        return this.#active.get(legacyId);
    }
    get activeCount() {
        return this.#active.size;
    }
}
