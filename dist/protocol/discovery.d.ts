import { SERVER_INFO_META_KEY } from "@modelcontextprotocol/server";
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
export declare function buildDiscoverResult(options: DiscoveryOptions): DiscoverResult;
