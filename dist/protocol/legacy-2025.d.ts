export declare const LEGACY_WIRE_ERA: "2025-11-25";
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
export declare function buildLegacyRequestContext(request: LegacyTransportRequest): LegacyRequestContext;
export type AffordanceOutcome = {
    readonly kind: "serve";
} | {
    readonly kind: "refuse";
    readonly httpStatus: number;
    readonly code: number;
    readonly message: string;
};
export declare function classifyRemovedAffordance(input: {
    readonly httpMethod: string;
    readonly headers?: Readonly<Record<string, string>>;
}): AffordanceOutcome;
export declare function ignoredHeaderNames(): readonly string[];
export type AttachOutcome = {
    readonly ok: true;
    readonly clientId: string;
} | {
    readonly ok: false;
    readonly reason: "ANOTHER_CLIENT_IS_ACTIVE";
    readonly activeClientId: string;
};
export declare class LegacyClientRegistry {
    #private;
    attach(legacyId: string, clientId: string): AttachOutcome;
    detach(legacyId: string, clientId: string): void;
    activeClient(legacyId: string): string | undefined;
    get activeCount(): number;
}
