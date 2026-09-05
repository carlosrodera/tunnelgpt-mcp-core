import { createMcpHandler } from "@modelcontextprotocol/server";
export function createCoreMcpHandler(options) {
    return createMcpHandler((context) => {
        options.onInstance?.(context.era);
        return options.createServer();
    }, { legacy: "stateless", ...(options.onError === undefined ? {} : { onerror: options.onError }) });
}
