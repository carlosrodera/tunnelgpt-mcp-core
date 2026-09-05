import { LOG_LEVEL_META_KEY, METHOD_NOT_FOUND } from "@modelcontextprotocol/server";
import { LDCH_TARGET_WIRE_ERA } from "./capability-probe.js";
import { buildDiscoverResult } from "./discovery.js";
import { LEGACY_WIRE_ERA } from "./legacy-2025.js";
export function selectEra(input) {
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
const REMOVED_METHODS = new Set(["initialize", "notifications/initialized"]);
export const DEPRECATED_CAPABILITIES = Object.freeze(["logging", "elicitation"]);
const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];
export function requestedLogLevel(request) {
    const params = request["params"];
    if (params === null || typeof params !== "object")
        return undefined;
    const meta = params["_meta"];
    if (meta === null || typeof meta !== "object")
        return undefined;
    const level = meta[LOG_LEVEL_META_KEY];
    return typeof level === "string" && LOG_LEVELS.includes(level) ? level : undefined;
}
export function mayEmitLogNotification(request, level) {
    const requested = requestedLogLevel(request);
    if (requested === undefined)
        return false;
    const at = LOG_LEVELS.indexOf(level);
    const threshold = LOG_LEVELS.indexOf(requested);
    return at >= 0 && at >= threshold;
}
function ok(id, result) {
    return { jsonrpc: "2.0", id, result };
}
function fail(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } };
}
export function createModernRoute(options) {
    return {
        async handle(request) {
            const id = (request["id"] ?? null);
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
