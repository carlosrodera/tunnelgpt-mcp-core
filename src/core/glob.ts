import path from "node:path";
import { TunnelGPTError } from "./errors.js";
function escapeRegexChar(char: string): string {
    return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}
export function normalizeRelativePath(value: string): string {
    return value.split(path.sep).join("/").replace(/^\.\//, "");
}
export function globToRegExp(patternInput: string, options: {
    anchored?: boolean;
    basename?: boolean;
} = {}): RegExp {
    const pattern = normalizeRelativePath(patternInput.trim());
    if (pattern.length > 1024 || pattern.includes("\0") || /[\r\n]/.test(pattern)) {
        throw new TunnelGPTError("INVALID_ARGUMENT", "Glob pattern is invalid or too long.");
    }
    let source = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index]!;
        if (char === "*") {
            if (pattern[index + 1] === "*") {
                while (pattern[index + 1] === "*")
                    index += 1;
                if (pattern[index + 1] === "/") {
                    index += 1;
                    source += "(?:.*/)?";
                }
                else {
                    source += ".*";
                }
            }
            else {
                source += "[^/]*";
            }
            continue;
        }
        if (char === "?") {
            source += "[^/]";
            continue;
        }
        source += escapeRegexChar(char);
    }
    if (options.basename === true)
        return new RegExp(`(?:^|/)${source}$`, "u");
    return new RegExp(`${options.anchored === false ? "(?:^|/)" : "^"}${source}$`, "u");
}
export function matchesGlob(relativePath: string, pattern: string): boolean {
    const normalized = normalizeRelativePath(relativePath);
    const cleaned = pattern.replace(/^\.\//, "");
    const basename = !cleaned.includes("/");
    return globToRegExp(cleaned, { anchored: !basename, basename }).test(normalized);
}
