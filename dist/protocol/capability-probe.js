export const LDCH_TARGET_WIRE_ERA = "2026-07-28";
export const REQUIRED_SDK_CAPABILITIES = Object.freeze([
    { name: "PerRequestHTTPServerTransport", module: "server", why: "the stateless per-request route the modern era is built on" },
    { name: "DiscoverRequestSchema", module: "core", why: "discovery is mandatory in the target era and replaces initialization" },
    { name: "DiscoverResultSchema", module: "core", why: "the discovery response shape the conformance corpus asserts" },
    { name: "PROTOCOL_VERSION_META_KEY", module: "server", why: "the per-request protocol version field the envelope validator requires" },
    { name: "CLIENT_CAPABILITIES_META_KEY", module: "server", why: "the required per-request capability declaration" },
    { name: "CLIENT_INFO_META_KEY", module: "server", why: "optional client identity, validated when present" },
    { name: "LOG_LEVEL_META_KEY", module: "server", why: "log notifications are only permitted for requests that asked for them" },
    { name: "SERVER_INFO_META_KEY", module: "server", why: "server identity echoed on every result" },
    { name: "ProtocolErrorCode", module: "server", why: "the renumbered specification error codes the error corpus asserts" },
    { name: "inputRequired", module: "server", why: "multi round-trip requests, which the retry corpus depends on" },
    { name: "isInputRequiredResult", module: "server", why: "discriminating an interim result from a complete one" },
    { name: "classifyInboundRequest", module: "server", why: "era discrimination between the modern route and the legacy adapter" },
    { name: "createRequestStateCodec", module: "server", why: "explicit state handles, since the era carries no transport session" },
]);
export async function probeSdkCapabilities(sdkOverride) {
    const modules = sdkOverride
        ? { server: sdkOverride, core: sdkOverride }
        : {
            server: (await import("@modelcontextprotocol/server")),
            core: (await import("@modelcontextprotocol/core")),
        };
    const missing = REQUIRED_SDK_CAPABILITIES
        .filter(({ name, module }) => modules[module][name] === undefined)
        .map(({ name }) => name);
    return { ok: missing.length === 0, missing, targetWireEra: LDCH_TARGET_WIRE_ERA };
}
export async function assertSdkCapabilities() {
    const result = await probeSdkCapabilities();
    if (!result.ok) {
        const detail = REQUIRED_SDK_CAPABILITIES.filter((c) => result.missing.includes(c.name))
            .map((c) => `  ${c.name} — ${c.why}`)
            .join("\n");
        throw new Error(`the linked MCP SDK no longer provides mechanisms the ${LDCH_TARGET_WIRE_ERA} conformance corpus depends on:\n${detail}`);
    }
}
