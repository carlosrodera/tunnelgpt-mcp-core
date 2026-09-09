import { LDCH_TARGET_WIRE_ERA } from "./capability-probe.js";
import { type ServerIdentity } from "./discovery.js";
import { LEGACY_WIRE_ERA } from "./legacy-2025.js";
export type WireEra = typeof LDCH_TARGET_WIRE_ERA | typeof LEGACY_WIRE_ERA;
export interface EraSelection {
    readonly era: WireEra;
    readonly reason: string;
}
export declare function selectEra(input: {
    readonly requestedEra?: string;
    readonly modernEnabled: boolean;
}): EraSelection;
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
export declare const DEPRECATED_CAPABILITIES: readonly ["logging", "elicitation"];
export declare function requestedLogLevel(request: Record<string, unknown>): string | undefined;
export declare function mayEmitLogNotification(request: Record<string, unknown>, level: string): boolean;
export declare function createModernRoute(options: ModernRouteOptions): ModernRoute;
