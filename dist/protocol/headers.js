const SENTINEL = /^=\?base64\?(.*)\?=$/u;
const NAME_BEARING_METHODS = new Set(["tools/call", "resources/read", "prompts/get"]);
const HEADER_MISMATCH = -32020;
export function encodeSentinel(value) {
    return `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
function decodeSentinel(value) {
    const match = SENTINEL.exec(value);
    if (!match)
        return value;
    return Buffer.from(match[1] ?? "", "base64").toString("utf8");
}
function lookup(headers, name) {
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === wanted)
            return value;
    }
    return undefined;
}
function mismatch(header, reason) {
    return {
        ok: false,
        code: HEADER_MISMATCH,
        httpStatus: 400,
        message: reason === "missing" ? `${header} is required` : `${header} does not match the request body`,
    };
}
export function validateMirroredHeaders(headers, body, options = {}) {
    const version = lookup(headers, "MCP-Protocol-Version");
    if (version === undefined)
        return mismatch("MCP-Protocol-Version", "missing");
    if (body.protocolVersion !== undefined && decodeSentinel(version) !== body.protocolVersion) {
        return mismatch("MCP-Protocol-Version", "mismatch");
    }
    const method = lookup(headers, "Mcp-Method");
    if (method === undefined)
        return mismatch("Mcp-Method", "missing");
    if (body.method !== undefined && decodeSentinel(method) !== body.method) {
        return mismatch("Mcp-Method", "mismatch");
    }
    const nameRequired = body.method !== undefined && NAME_BEARING_METHODS.has(body.method);
    const name = lookup(headers, "Mcp-Name");
    if (nameRequired) {
        if (name === undefined)
            return mismatch("Mcp-Name", "missing");
        const expected = body.params?.name ?? body.params?.uri;
        if (expected !== undefined && decodeSentinel(name) !== expected) {
            return mismatch("Mcp-Name", "mismatch");
        }
    }
    else if (name !== undefined) {
        const expected = body.params?.name ?? body.params?.uri;
        if (expected !== undefined && decodeSentinel(name) !== expected) {
            return mismatch("Mcp-Name", "mismatch");
        }
    }
    for (const parameter of options.mirroredParameters ?? []) {
        const header = lookup(headers, `Mcp-Param-${parameter}`);
        const expected = body.params?.[parameter];
        if (header === undefined) {
            if (expected !== undefined && expected !== null)
                return mismatch(`Mcp-Param-${parameter}`, "missing");
            continue;
        }
        if (expected === undefined || expected === null)
            return mismatch(`Mcp-Param-${parameter}`, "mismatch");
        if (decodeSentinel(header) !== String(expected))
            return mismatch(`Mcp-Param-${parameter}`, "mismatch");
    }
    return { ok: true };
}
