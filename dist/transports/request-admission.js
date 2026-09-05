function invalid(limits) {
    return !Number.isSafeInteger(limits.maxActive) || limits.maxActive < 1
        || !Number.isSafeInteger(limits.maxQueued) || limits.maxQueued < 0
        || !Number.isFinite(limits.queueTimeoutMs) || limits.queueTimeoutMs < 1;
}
export class RequestAdmission {
    #limits;
    #waiting = [];
    #active = 0;
    #closed = false;
    constructor(limits) {
        if (invalid(limits))
            throw new Error("Request admission limits are invalid.");
        this.#limits = limits;
    }
    get snapshot() {
        return { active: this.#active, queued: this.#waiting.length };
    }
    async acquire(signal) {
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
        return new Promise((resolve) => {
            const waiter = {
                settled: false,
                timer: setTimeout(() => this.#settle(waiter, { kind: "overloaded", reason: "queue-timeout", retryAfterMs: this.#limits.queueTimeoutMs }), this.#limits.queueTimeoutMs),
                settle: resolve,
                ...(signal === undefined ? {} : { signal }),
            };
            if (signal !== undefined) {
                const onAbort = () => this.#settle(waiter, { kind: "overloaded", reason: "cancelled", retryAfterMs: 0 });
                waiter.onAbort = onAbort;
                signal.addEventListener("abort", onAbort, { once: true });
            }
            waiter.timer.unref?.();
            this.#waiting.push(waiter);
        });
    }
    close() {
        if (this.#closed)
            return;
        this.#closed = true;
        while (this.#waiting.length > 0) {
            const waiter = this.#waiting.shift();
            this.#settle(waiter, { kind: "overloaded", reason: "shutting-down", retryAfterMs: 0 }, false);
        }
    }
    #releaser() {
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.#active -= 1;
            this.#promote();
        };
    }
    #promote() {
        if (this.#closed)
            return;
        while (this.#active < this.#limits.maxActive && this.#waiting.length > 0) {
            const waiter = this.#waiting.shift();
            if (waiter.settled)
                continue;
            this.#active += 1;
            this.#finish(waiter, { kind: "admitted", release: this.#releaser() });
        }
    }
    #settle(waiter, outcome, removeFromQueue = true) {
        if (waiter.settled)
            return;
        if (removeFromQueue) {
            const at = this.#waiting.indexOf(waiter);
            if (at >= 0)
                this.#waiting.splice(at, 1);
        }
        this.#finish(waiter, outcome);
    }
    #finish(waiter, outcome) {
        waiter.settled = true;
        clearTimeout(waiter.timer);
        if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
            waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        waiter.settle(outcome);
    }
}
