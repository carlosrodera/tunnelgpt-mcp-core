export const LEGACY_WIRE_ERA = "2025-11-25" as const;
export interface LegacyTransportRequest {
    readonly method: string;
    readonly params?: Record<string, unknown>;
    readonly sessionId?: string;
}
export interface LegacyRequestContext {
    readonly era: typeof LEGACY_WIRE_ERA;
    readonly method: string;
    readonly params: Readonly<Record<string, unknown>>;
}
export function buildLegacyRequestContext(request: LegacyTransportRequest): LegacyRequestContext {
    return { era: LEGACY_WIRE_ERA, method: request.method, params: { ...(request.params ?? {}) } };
}
export type AffordanceOutcome = {
    readonly kind: "serve";
} | {
    readonly kind: "refuse";
    readonly httpStatus: number;
    readonly code: number;
    readonly message: string;
};
const SERVE: AffordanceOutcome = Object.freeze({ kind: "serve" });
const IGNORED_HEADERS = ["mcp-session-id", "last-event-id"] as const;
function lookup(headers: Readonly<Record<string, string>>, name: string): string | undefined {
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === wanted)
            return value;
    }
    return undefined;
}
export function classifyRemovedAffordance(input: {
    readonly httpMethod: string;
    readonly headers?: Readonly<Record<string, string>>;
}): AffordanceOutcome {
    const headers = input.headers ?? {};
    if (lookup(headers, "origin") !== undefined) {
        return { kind: "refuse", httpStatus: 403, code: -32000, message: "origin is not allowed on the local transport" };
    }
    if (input.httpMethod.toUpperCase() !== "POST") {
        return { kind: "refuse", httpStatus: 405, code: -32000, message: `${input.httpMethod} is not allowed on the rpc endpoint` };
    }
    return SERVE;
}
export function ignoredHeaderNames(): readonly string[] {
    return IGNORED_HEADERS;
}
export type AttachOutcome = {
    readonly ok: true;
    readonly clientId: string;
} | {
    readonly ok: false;
    readonly reason: "ANOTHER_CLIENT_IS_ACTIVE";
    readonly activeClientId: string;
};
export class LegacyClientRegistry {
    readonly #active = new Map<string, string>();
    public attach(legacyId: string, clientId: string): AttachOutcome {
        const holder = this.#active.get(legacyId);
        if (holder !== undefined && holder !== clientId) {
            return { ok: false, reason: "ANOTHER_CLIENT_IS_ACTIVE", activeClientId: holder };
        }
        this.#active.set(legacyId, clientId);
        return { ok: true, clientId };
    }
    public detach(legacyId: string, clientId: string): void {
        if (this.#active.get(legacyId) === clientId)
            this.#active.delete(legacyId);
    }
    public activeClient(legacyId: string): string | undefined {
        return this.#active.get(legacyId);
    }
    public get activeCount(): number {
        return this.#active.size;
    }
}
