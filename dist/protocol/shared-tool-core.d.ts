import { type LegacyTransportRequest } from "./legacy-2025.js";
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
export declare function coreRequestFromModern(request: {
    readonly method: string;
    readonly params?: Readonly<Record<string, unknown>>;
}): CoreRequest;
export declare function coreRequestFromLegacy(request: LegacyTransportRequest): CoreRequest;
export declare function createSharedToolCore(options: SharedToolCoreOptions): SharedToolCore;
