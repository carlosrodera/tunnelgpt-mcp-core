import type { KeyRing } from "../core/key-ring.js";
export declare const INPUT_REQUIRED: "input_required";
export interface InterimResult {
    readonly kind: typeof INPUT_REQUIRED;
    readonly prompt: string;
    readonly retryToken: string;
}
export interface RetryClaim {
    readonly idempotencyIdentity: string;
    readonly toolIdentity: string;
    readonly expiresAt: number;
}
export type RetryResolution = {
    readonly ok: true;
    readonly claim: RetryClaim;
} | {
    readonly ok: false;
    readonly reason: "RETRY_MALFORMED" | "RETRY_INVALID" | "RETRY_EXPIRED" | "RETRY_TOOL_MISMATCH";
};
export declare class MultiRoundTripCodec {
    #private;
    constructor(options: {
        keyRing: KeyRing;
        now: () => number;
    });
    requestInput(input: {
        readonly prompt: string;
        readonly idempotencyIdentity: string;
        readonly toolIdentity: string;
        readonly ttlMs: number;
    }): InterimResult;
    resolveRetry(token: string, toolIdentity: string): RetryResolution;
}
