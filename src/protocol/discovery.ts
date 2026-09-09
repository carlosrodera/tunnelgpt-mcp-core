import { SERVER_INFO_META_KEY } from "@modelcontextprotocol/server";
import { LDCH_TARGET_WIRE_ERA } from "./capability-probe.js";
export { SERVER_INFO_META_KEY };
export interface ServerIdentity {
    readonly name: string;
    readonly version: string;
}
export interface DiscoveryOptions {
    readonly identity: ServerIdentity;
    readonly extensions?: readonly string[];
}
export interface DiscoverResult {
    readonly supportedVersions: readonly string[];
    readonly capabilities: Readonly<Record<string, unknown>>;
    readonly extensions: readonly string[];
    readonly _meta: Readonly<Record<string, ServerIdentity>>;
}
const CAPABILITIES: Readonly<Record<string, unknown>> = Object.freeze({ tools: Object.freeze({}) });
export function buildDiscoverResult(options: DiscoveryOptions): DiscoverResult {
    return {
        supportedVersions: [LDCH_TARGET_WIRE_ERA],
        capabilities: CAPABILITIES,
        extensions: [...(options.extensions ?? [])],
        _meta: { [SERVER_INFO_META_KEY]: { name: options.identity.name, version: options.identity.version } },
    };
}
