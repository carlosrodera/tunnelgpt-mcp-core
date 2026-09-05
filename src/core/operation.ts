import { randomUUID } from "node:crypto";
import { TunnelGPTError } from "./errors.js";
import type { OperationContext } from "./file-access-config.js";
export function createOperationContext(signal?: AbortSignal): OperationContext {
    return signal === undefined ? { correlationId: randomUUID() } : { correlationId: randomUUID(), signal };
}
export function assertNotCancelled(signal?: AbortSignal): void {
    if (signal?.aborted === true)
        throw new TunnelGPTError("CANCELLED", "Operation was cancelled.");
}
export async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    timer.unref();
    const abortParent = (): void => controller.abort();
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
