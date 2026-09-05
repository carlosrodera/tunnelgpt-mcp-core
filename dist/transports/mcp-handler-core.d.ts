import { type McpHttpHandler, type Server } from "@modelcontextprotocol/server";
export type WireEraLabel = "legacy" | "modern";
export interface CoreHandlerOptions {
    readonly createServer: () => Server;
    readonly onInstance?: (era: WireEraLabel) => void;
    readonly onError?: (error: Error) => void;
}
export declare function createCoreMcpHandler(options: CoreHandlerOptions): McpHttpHandler;
