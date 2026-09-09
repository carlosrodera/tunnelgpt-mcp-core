import type { OperationContext } from "./file-access-config.js";
export declare function createOperationContext(signal?: AbortSignal): OperationContext;
export declare function assertNotCancelled(signal?: AbortSignal): void;
export declare function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T>;
