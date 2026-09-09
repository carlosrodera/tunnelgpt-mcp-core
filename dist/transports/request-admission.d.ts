export interface AdmissionLimits {
    readonly maxActive: number;
    readonly maxQueued: number;
    readonly queueTimeoutMs: number;
}
export type AdmissionOutcome = {
    readonly kind: "admitted";
    readonly release: () => void;
} | {
    readonly kind: "overloaded";
    readonly reason: OverloadReason;
    readonly retryAfterMs: number;
};
export type OverloadReason = "queue-full" | "queue-timeout" | "cancelled" | "shutting-down";
export interface AdmissionSnapshot {
    readonly active: number;
    readonly queued: number;
}
export declare class RequestAdmission {
    #private;
    constructor(limits: AdmissionLimits);
    get snapshot(): AdmissionSnapshot;
    acquire(signal?: AbortSignal): Promise<AdmissionOutcome>;
    close(): void;
}
