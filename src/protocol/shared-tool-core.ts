import { buildLegacyRequestContext, type LegacyTransportRequest } from "./legacy-2025.js";
export interface CoreRequest {
    readonly method: string;
    readonly params: Readonly<Record<string, unknown>>;
}
export interface CoreResult {
    readonly ok: boolean;
    readonly value: unknown;
}
export interface SharedToolCoreOptions {
    readonly execute: (request: CoreRequest) => Promise<CoreResult> | CoreResult;
}
export interface SharedToolCore {
    handle(request: CoreRequest): Promise<CoreResult>;
}
export function coreRequestFromModern(request: {
    readonly method: string;
    readonly params?: Readonly<Record<string, unknown>>;
}): CoreRequest {
    return { method: request.method, params: { ...(request.params ?? {}) } };
}
export function coreRequestFromLegacy(request: LegacyTransportRequest): CoreRequest {
    const context = buildLegacyRequestContext(request);
    return { method: context.method, params: { ...context.params } };
}
export function createSharedToolCore(options: SharedToolCoreOptions): SharedToolCore {
    return {
        async handle(request: CoreRequest): Promise<CoreResult> {
            return options.execute(request);
        },
    };
}
