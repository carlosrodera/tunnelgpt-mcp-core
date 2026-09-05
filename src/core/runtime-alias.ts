import { TunnelGPTError } from "./errors.js";
declare const RUNTIME_ALIAS_BRAND: unique symbol;
export type RuntimeAlias = string & {
    readonly [RUNTIME_ALIAS_BRAND]: true;
};
const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const LEGACY_ROOT_ALIAS_SOURCE = "[A-Za-z][A-Za-z0-9_-]{0,31}";
export const RUNTIME_ALIAS_PATTERN = new RegExp(`^${UUID_V4_SOURCE}$`, "u");
export const ROOT_ALIAS_PATTERN = new RegExp(`^(?:${LEGACY_ROOT_ALIAS_SOURCE}|${UUID_V4_SOURCE})$`, "u");
export const ROOT_QUALIFIED_PATH_PATTERN = new RegExp(`^(${LEGACY_ROOT_ALIAS_SOURCE}|${UUID_V4_SOURCE}):[\\\\/](.*)$`, "su");
export const ROOT_QUALIFIED_PATH_PREFIX_PATTERN = new RegExp(`^(?:${LEGACY_ROOT_ALIAS_SOURCE}|${UUID_V4_SOURCE}):/`, "u");
const PROFILE_UUID_PATTERN = /^PROFILE_([0-9A-F]{8})_([0-9A-F]{4})_(4[0-9A-F]{3})_([89AB][0-9A-F]{3})_([0-9A-F]{12})$/u;
export function isRuntimeAlias(value: unknown): value is RuntimeAlias {
    return typeof value === "string" && RUNTIME_ALIAS_PATTERN.test(value);
}
export function parseRuntimeAlias(value: unknown): RuntimeAlias {
    if (!isRuntimeAlias(value)) {
        throw new TunnelGPTError("INVALID_ARGUMENT", "TUNNEL_RUNTIME_ALIAS_INVALID");
    }
    return value;
}
export function isRootAlias(value: unknown): value is string {
    return typeof value === "string" && ROOT_ALIAS_PATTERN.test(value);
}
export function runtimeAliasFromProfileId(profileId: string): RuntimeAlias | undefined {
    const match = PROFILE_UUID_PATTERN.exec(profileId);
    if (match === null)
        return undefined;
    return parseRuntimeAlias(match.slice(1).join("-").toLowerCase());
}
export function allocateRuntimeAlias(profileId: string): RuntimeAlias {
    return runtimeAliasFromProfileId(profileId) ?? parseRuntimeAlias(globalThis.crypto.randomUUID());
}
