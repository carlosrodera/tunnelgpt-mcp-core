import { createMcpHandler, type McpHttpHandler, type Server } from "@modelcontextprotocol/server";
export type WireEraLabel = "legacy" | "modern";
export interface CoreHandlerOptions {
    readonly createServer: () => Server;
    readonly onInstance?: (era: WireEraLabel) => void;
    readonly onError?: (error: Error) => void;
}
export function createCoreMcpHandler(options: CoreHandlerOptions): McpHttpHandler {
    return createMcpHandler((context) => {
        options.onInstance?.(context.era);
        return options.createServer();
    }, { legacy: "stateless", ...(options.onError === undefined ? {} : { onerror: options.onError }) });
}
