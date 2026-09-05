import type { McpHttpHandler } from "@modelcontextprotocol/server";
import type { WireEraLabel } from "./mcp-handler-core.js";
export interface UnixHttpMcpDependencies {
    readonly operationTimeoutMs: number;
    readonly createHandler: (onInstance: (era: WireEraLabel) => void) => McpHttpHandler;
}
export interface UnixHttpMcpServerOptions {
    readonly socketPath: string;
    readonly maxBodyBytes: number;
    readonly maxSessions: number;
    readonly maxConcurrentRequests: number;
    readonly maxQueuedRequests?: number;
    readonly queueTimeoutMs?: number;
    readonly sessionIdleTtlMs: number;
    readonly shutdownGraceMs: number;
}
export declare class UnixHttpMcpServer {
    #private;
    constructor(dependencies: UnixHttpMcpDependencies, options: UnixHttpMcpServerOptions);
    get activeSessionCount(): number;
    get admission(): {
        readonly active: number;
        readonly queued: number;
    };
    get instancesByEra(): Readonly<Record<WireEraLabel, number>>;
    get ready(): boolean;
    start(): Promise<void>;
    close(): Promise<void>;
}
