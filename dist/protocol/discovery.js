import { SERVER_INFO_META_KEY } from "@modelcontextprotocol/server";
import { LDCH_TARGET_WIRE_ERA } from "./capability-probe.js";
export { SERVER_INFO_META_KEY };
const CAPABILITIES = Object.freeze({ tools: Object.freeze({}) });
export function buildDiscoverResult(options) {
    return {
        supportedVersions: [LDCH_TARGET_WIRE_ERA],
        capabilities: CAPABILITIES,
        extensions: [...(options.extensions ?? [])],
        _meta: { [SERVER_INFO_META_KEY]: { name: options.identity.name, version: options.identity.version } },
    };
}
