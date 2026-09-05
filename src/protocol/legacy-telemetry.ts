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
export class LegacyTelemetry {
    readonly #now: () => number;
    readonly #enabled: boolean;
    readonly #byMethod = new Map<string, number>();
    #total = 0;
    #lastReset: {
        at: number;
        discarded: number;
    } | null = null;
    public constructor(options: LegacyTelemetryOptions) {
        this.#enabled = options.enabled;
        this.#now = options.now;
    }
    public get enabled(): boolean {
        return this.#enabled;
    }
    public record(method: string): void {
        this.#total += 1;
        this.#byMethod.set(method, (this.#byMethod.get(method) ?? 0) + 1);
    }
    public reset(): void {
        this.#lastReset = { at: this.#now(), discarded: this.#total };
        this.#total = 0;
        this.#byMethod.clear();
    }
    public snapshot(): LegacyUsageSnapshot {
        return {
            total: this.#total,
            byMethod: Object.fromEntries([...this.#byMethod.entries()].sort()),
            lastReset: this.#lastReset === null ? null : { ...this.#lastReset },
            enabled: this.#enabled,
        };
    }
}
