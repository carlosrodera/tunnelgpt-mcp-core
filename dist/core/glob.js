import path from "node:path";
import { TunnelGPTError } from "./errors.js";
function escapeRegexChar(char) {
    return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}
export function normalizeRelativePath(value) {
    return value.split(path.sep).join("/").replace(/^\.\//, "");
}
export function globToRegExp(patternInput, options = {}) {
    const pattern = normalizeRelativePath(patternInput.trim());
    if (pattern.length > 1024 || pattern.includes("\0") || /[\r\n]/.test(pattern)) {
        throw new TunnelGPTError("INVALID_ARGUMENT", "Glob pattern is invalid or too long.");
    }
    let source = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
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
export function matchesGlob(relativePath, pattern) {
    const normalized = normalizeRelativePath(relativePath);
    const cleaned = pattern.replace(/^\.\//, "");
    const basename = !cleaned.includes("/");
    return globToRegExp(cleaned, { anchored: !basename, basename }).test(normalized);
}
