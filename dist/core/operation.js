import { randomUUID } from "node:crypto";
import { TunnelGPTError } from "./errors.js";
export function createOperationContext(signal) {
    return signal === undefined ? { correlationId: randomUUID() } : { correlationId: randomUUID(), signal };
}
export function assertNotCancelled(signal) {
    if (signal?.aborted === true)
        throw new TunnelGPTError("CANCELLED", "Operation was cancelled.");
}
export async function withTimeout(operation, timeoutMs, parent) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    timer.unref();
    const abortParent = () => controller.abort();
    parent?.addEventListener("abort", abortParent, { once: true });
    try {
        const result = await operation(controller.signal);
        if (parent?.aborted === true)
            throw new TunnelGPTError("CANCELLED", "Operation was cancelled.");
        if (timedOut)
            throw new TunnelGPTError("TIMEOUT", "Operation exceeded its time limit.");
        return result;
    }
    catch (error) {
        if (timedOut)
            throw new TunnelGPTError("TIMEOUT", "Operation exceeded its time limit.");
        if (parent?.aborted === true || controller.signal.aborted)
            throw new TunnelGPTError("CANCELLED", "Operation was cancelled.");
        throw error;
    }
    finally {
        clearTimeout(timer);
        parent?.removeEventListener("abort", abortParent);
    }
}
