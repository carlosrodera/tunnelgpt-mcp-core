import { LOG_LEVEL_META_KEY, METHOD_NOT_FOUND } from "@modelcontextprotocol/server";
import { LDCH_TARGET_WIRE_ERA } from "./capability-probe.js";
import { buildDiscoverResult, type ServerIdentity } from "./discovery.js";
import { LEGACY_WIRE_ERA } from "./legacy-2025.js";
export type WireEra = typeof LDCH_TARGET_WIRE_ERA | typeof LEGACY_WIRE_ERA;
export interface EraSelection {
    readonly era: WireEra;
    readonly reason: string;
}
export function selectEra(input: {
    readonly requestedEra?: string;
    readonly modernEnabled: boolean;
}): EraSelection {
    if (!input.modernEnabled) {
        return { era: LEGACY_WIRE_ERA, reason: "the modern era is not enabled on this deployment" };
    }
    if (input.requestedEra === LDCH_TARGET_WIRE_ERA) {
        return { era: LDCH_TARGET_WIRE_ERA, reason: "the caller asked for the modern era by its exact name" };
    }
    return {
        era: LEGACY_WIRE_ERA,
        reason: input.requestedEra === undefined
            ? "no era was requested, so the caller keeps the one it had"
            : "the requested era is not the modern era, and no upgrade is inferred",
    };
}
export interface ModernRouteOptions {
    readonly identity: ServerIdentity;
    readonly extensions?: readonly string[];
    readonly listTools: () => readonly unknown[] | Promise<readonly unknown[]>;
}
export interface JsonRpcResponse {
    readonly jsonrpc: "2.0";
    readonly id: string | number | null;
    readonly result?: unknown;
    readonly error?: {
        readonly code: number;
        readonly message: string;
    };
}
export interface ModernRoute {
    handle(request: Record<string, unknown>): Promise<JsonRpcResponse>;
}
const REMOVED_METHODS = new Set(["initialize", "notifications/initialized"]);
export const DEPRECATED_CAPABILITIES = Object.freeze(["logging", "elicitation"] as const);
const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"] as const;
export function requestedLogLevel(request: Record<string, unknown>): string | undefined {
    const params = request["params"];
    if (params === null || typeof params !== "object")
        return undefined;
    const meta = (params as Record<string, unknown>)["_meta"];
    if (meta === null || typeof meta !== "object")
        return undefined;
    const level = (meta as Record<string, unknown>)[LOG_LEVEL_META_KEY];
    return typeof level === "string" && (LOG_LEVELS as readonly string[]).includes(level) ? level : undefined;
}
export function mayEmitLogNotification(request: Record<string, unknown>, level: string): boolean {
    const requested = requestedLogLevel(request);
    if (requested === undefined)
        return false;
    const at = LOG_LEVELS.indexOf(level as (typeof LOG_LEVELS)[number]);
    const threshold = LOG_LEVELS.indexOf(requested as (typeof LOG_LEVELS)[number]);
    return at >= 0 && at >= threshold;
}
function ok(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
}
function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
}
export function createModernRoute(options: ModernRouteOptions): ModernRoute {
    return {
        async handle(request: Record<string, unknown>): Promise<JsonRpcResponse> {
            const id = (request["id"] ?? null) as string | number | null;
            const method = request["method"];
            if (typeof method !== "string")
                return fail(id, METHOD_NOT_FOUND, "request carries no method");
            if (REMOVED_METHODS.has(method)) {
                return fail(id, METHOD_NOT_FOUND, `${method} does not exist in this protocol era`);
            }
            switch (method) {
                case "server/discover":
                    return ok(id, buildDiscoverResult({ identity: options.identity, extensions: options.extensions }));
                case "tools/list":
                    return ok(id, { tools: [...(await options.listTools())] });
                default:
                    return fail(id, METHOD_NOT_FOUND, `${method} is not served by the modern route`);
            }
        },
    };
}
