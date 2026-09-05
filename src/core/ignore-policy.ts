import fs from "node:fs/promises";
import path from "node:path";
import type { CanonicalRoot } from "./file-access-config.js";
import { matchesGlob, normalizeRelativePath } from "./glob.js";
export const DEFAULT_DENY_PATTERNS = Object.freeze([
    "**/.ssh/**",
    "**/.aws/**",
    "**/.gnupg/**",
    "**/Library/Keychains/**",
    "**/Library/Application Support/Google/Chrome/**",
    "**/Library/Application Support/ChatGPT/**",
    "**/.config/gcloud/**",
    "**/credentials/**",
    "**/secrets/**",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/id_rsa",
    "**/id_ed25519",
    "**/node_modules/**",
    "**/.git/objects/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",
]);
interface IgnoreRule {
    readonly base: string;
    readonly pattern: string;
    readonly negated: boolean;
    readonly directoryOnly: boolean;
}
interface CachedRules {
    readonly signature: string;
    readonly rules: readonly IgnoreRule[];
}
function parseIgnoreText(text: string, base: string): IgnoreRule[] {
    const rules: IgnoreRule[] = [];
    for (const rawLine of text.split(/\r?\n/u)) {
        let line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#"))
            continue;
        let negated = false;
        if (line.startsWith("!")) {
            negated = true;
            line = line.slice(1);
        }
        if (line.startsWith("\\#") || line.startsWith("\\!"))
            line = line.slice(1);
        const directoryOnly = line.endsWith("/");
        if (directoryOnly)
            line = line.slice(0, -1);
        line = line.replace(/^\//, "");
        if (line.length === 0 || line.length > 1024 || /[\0\r\n]/.test(line))
            continue;
        rules.push({ base, pattern: line, negated, directoryOnly });
    }
    return rules;
}
function isRuleMatch(relativePath: string, isDirectory: boolean, rule: IgnoreRule): boolean {
    if (rule.directoryOnly && !isDirectory)
        return false;
    const normalized = normalizeRelativePath(relativePath);
    if (rule.base !== "") {
        if (normalized !== rule.base && !normalized.startsWith(`${rule.base}/`))
            return false;
    }
    const local = rule.base === "" ? normalized : normalized.slice(rule.base.length + 1);
    if (!rule.pattern.includes("/")) {
        return matchesGlob(local, rule.pattern) || local.split("/").some((segment) => matchesGlob(segment, rule.pattern));
    }
    return matchesGlob(local, rule.pattern);
}
export class IgnorePolicy {
    readonly #additionalPatterns: readonly string[];
    readonly #dynamicDeniedAbsolutePaths: ReadonlySet<string>;
    readonly #rulesCache = new Map<string, CachedRules>();
    public constructor(additionalPatterns: readonly string[], dynamicDeniedAbsolutePaths: readonly string[]) {
        this.#additionalPatterns = additionalPatterns;
        this.#dynamicDeniedAbsolutePaths = new Set(dynamicDeniedAbsolutePaths.map((item) => path.resolve(item)));
    }
    public isHardDenied(root: CanonicalRoot, absolutePath: string, relativePath: string): boolean {
        const resolved = path.resolve(absolutePath);
        for (const denied of this.#dynamicDeniedAbsolutePaths) {
            if (resolved === denied || resolved.startsWith(`${denied}${path.sep}`))
                return true;
        }
        const normalized = normalizeRelativePath(relativePath);
        const candidates = [normalized, `/${normalized}`];
        return [...DEFAULT_DENY_PATTERNS, ...this.#additionalPatterns].some((pattern) => candidates.some((candidate) => matchesGlob(candidate.replace(/^\//, ""), pattern)));
    }
    public async isIgnored(root: CanonicalRoot, relativePath: string, isDirectory: boolean): Promise<boolean> {
        const normalized = normalizeRelativePath(relativePath);
        const directory = isDirectory ? normalized : path.posix.dirname(normalized);
        const ancestors: string[] = [""];
        if (directory !== "." && directory !== "") {
            const segments = directory.split("/");
            let current = "";
            for (const segment of segments) {
                current = current === "" ? segment : `${current}/${segment}`;
                ancestors.push(current);
            }
        }
        let ignored = false;
        for (const base of ancestors) {
            const rules = await this.#loadRules(root, base);
            for (const rule of rules) {
                if (isRuleMatch(normalized, isDirectory, rule))
                    ignored = !rule.negated;
            }
        }
        return ignored;
    }
    async #loadRules(root: CanonicalRoot, base: string): Promise<readonly IgnoreRule[]> {
        const cacheKey = `${root.path}\0${base}`;
        const directory = base === "" ? root.path : path.join(root.path, ...base.split("/"));
        const files = [".gitignore", ".mcpignore"].map((fileName) => path.join(directory, fileName));
        const signatureParts: string[] = [];
        for (const file of files) {
            try {
                const stat = await fs.stat(file);
                signatureParts.push(`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`);
            }
            catch {
                signatureParts.push("missing");
            }
        }
        const signature = signatureParts.join("|");
        const cached = this.#rulesCache.get(cacheKey);
        if (cached !== undefined && cached.signature === signature)
            return cached.rules;
        const rules: IgnoreRule[] = [];
        for (const file of files) {
            try {
                const text = await fs.readFile(file, "utf8");
                rules.push(...parseIgnoreText(text, base));
            }
            catch {
            }
        }
        const frozen = Object.freeze(rules);
        this.#rulesCache.set(cacheKey, { signature, rules: frozen });
        return frozen;
    }
}
