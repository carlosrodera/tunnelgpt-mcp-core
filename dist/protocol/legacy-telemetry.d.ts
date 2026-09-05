export interface LegacyUsageSnapshot {
    readonly total: number;
    readonly byMethod: Readonly<Record<string, number>>;
    readonly lastReset: {
        readonly at: number;
        readonly discarded: number;
    } | null;
    readonly enabled: boolean;
}
export interface LegacyTelemetryOptions {
    readonly enabled: boolean;
    readonly now: () => number;
}
export declare class LegacyTelemetry {
    #private;
    constructor(options: LegacyTelemetryOptions);
    get enabled(): boolean;
    record(method: string): void;
    reset(): void;
    snapshot(): LegacyUsageSnapshot;
}
