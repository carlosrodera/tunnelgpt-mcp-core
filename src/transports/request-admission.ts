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
interface Waiter {
    readonly settle: (outcome: AdmissionOutcome) => void;
    readonly timer: NodeJS.Timeout;
    readonly onAbort?: () => void;
    readonly signal?: AbortSignal;
    settled: boolean;
}
function invalid(limits: AdmissionLimits): boolean {
    return !Number.isSafeInteger(limits.maxActive) || limits.maxActive < 1
        || !Number.isSafeInteger(limits.maxQueued) || limits.maxQueued < 0
        || !Number.isFinite(limits.queueTimeoutMs) || limits.queueTimeoutMs < 1;
}
export class RequestAdmission {
    readonly #limits: AdmissionLimits;
    readonly #waiting: Waiter[] = [];
    #active = 0;
    #closed = false;
    public constructor(limits: AdmissionLimits) {
        if (invalid(limits))
            throw new Error("Request admission limits are invalid.");
        this.#limits = limits;
    }
    public get snapshot(): AdmissionSnapshot {
        return { active: this.#active, queued: this.#waiting.length };
    }
    public async acquire(signal?: AbortSignal): Promise<AdmissionOutcome> {
        if (this.#closed)
            return { kind: "overloaded", reason: "shutting-down", retryAfterMs: 0 };
        if (signal?.aborted === true)
            return { kind: "overloaded", reason: "cancelled", retryAfterMs: 0 };
        if (this.#active < this.#limits.maxActive) {
            this.#active += 1;
            return { kind: "admitted", release: this.#releaser() };
        }
        if (this.#waiting.length >= this.#limits.maxQueued) {
            return { kind: "overloaded", reason: "queue-full", retryAfterMs: this.#limits.queueTimeoutMs };
        }
        return new Promise<AdmissionOutcome>((resolve) => {
            const waiter: Waiter = {
                settled: false,
                timer: setTimeout(() => this.#settle(waiter, { kind: "overloaded", reason: "queue-timeout", retryAfterMs: this.#limits.queueTimeoutMs }), this.#limits.queueTimeoutMs),
                settle: resolve,
                ...(signal === undefined ? {} : { signal }),
            };
            if (signal !== undefined) {
                const onAbort = (): void => this.#settle(waiter, { kind: "overloaded", reason: "cancelled", retryAfterMs: 0 });
                (waiter as {
                    onAbort?: () => void;
                }).onAbort = onAbort;
                signal.addEventListener("abort", onAbort, { once: true });
            }
            waiter.timer.unref?.();
            this.#waiting.push(waiter);
        });
    }
    public close(): void {
        if (this.#closed)
            return;
        this.#closed = true;
        while (this.#waiting.length > 0) {
            const waiter = this.#waiting.shift() as Waiter;
            this.#settle(waiter, { kind: "overloaded", reason: "shutting-down", retryAfterMs: 0 }, false);
        }
    }
    #releaser(): () => void {
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.#active -= 1;
            this.#promote();
        };
    }
    #promote(): void {
        if (this.#closed)
            return;
        while (this.#active < this.#limits.maxActive && this.#waiting.length > 0) {
            const waiter = this.#waiting.shift() as Waiter;
            if (waiter.settled)
                continue;
            this.#active += 1;
            this.#finish(waiter, { kind: "admitted", release: this.#releaser() });
        }
    }
    #settle(waiter: Waiter, outcome: AdmissionOutcome, removeFromQueue = true): void {
        if (waiter.settled)
            return;
        if (removeFromQueue) {
            const at = this.#waiting.indexOf(waiter);
            if (at >= 0)
                this.#waiting.splice(at, 1);
        }
        this.#finish(waiter, outcome);
    }
    #finish(waiter: Waiter, outcome: AdmissionOutcome): void {
        waiter.settled = true;
        clearTimeout(waiter.timer);
        if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
            waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        waiter.settle(outcome);
    }
}
