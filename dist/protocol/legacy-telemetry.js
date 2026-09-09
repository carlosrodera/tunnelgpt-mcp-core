export class LegacyTelemetry {
    #now;
    #enabled;
    #byMethod = new Map();
    #total = 0;
    #lastReset = null;
    constructor(options) {
        this.#enabled = options.enabled;
        this.#now = options.now;
    }
    get enabled() {
        return this.#enabled;
    }
    record(method) {
        this.#total += 1;
        this.#byMethod.set(method, (this.#byMethod.get(method) ?? 0) + 1);
    }
    reset() {
        this.#lastReset = { at: this.#now(), discarded: this.#total };
        this.#total = 0;
        this.#byMethod.clear();
    }
    snapshot() {
        return {
            total: this.#total,
            byMethod: Object.fromEntries([...this.#byMethod.entries()].sort()),
            lastReset: this.#lastReset === null ? null : { ...this.#lastReset },
            enabled: this.#enabled,
        };
    }
}
