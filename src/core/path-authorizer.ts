import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { TunnelGPTError } from "./errors.js";
import { normalizeRelativePath } from "./glob.js";
import { IgnorePolicy } from "./ignore-policy.js";
import { ROOT_QUALIFIED_PATH_PATTERN } from "./runtime-alias.js";
import type { FileAccessConfig, AuthorizedPath, CanonicalRoot } from "./file-access-config.js";
export type ExistingPathKind = "any" | "file" | "directory";
const WINDOWS_DEVICE = /^(?:\\\\\.\\|\\\\\?\\|\\\.\\|(?:[A-Za-z]:)?[\\/](?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:[.\\/]|$))/iu;
const URL_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/u;
const UNC_PATH = /^(?:\\\\|\/\/)[^/\\]+[/\\][^/\\]+/u;
function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function statType(stat: fsSync.Stats): "file" | "directory" | "symlink" | "special" {
    if (stat.isSymbolicLink())
        return "symlink";
    if (stat.isFile())
        return "file";
    if (stat.isDirectory())
        return "directory";
    return "special";
}
export class PathAuthorizer {
    readonly #config: FileAccessConfig;
    readonly #roots: readonly CanonicalRoot[];
    readonly #rootsByAlias: ReadonlyMap<string, CanonicalRoot>;
    readonly ignorePolicy: IgnorePolicy;
    private constructor(config: FileAccessConfig, roots: readonly CanonicalRoot[], ignorePolicy: IgnorePolicy) {
        this.#config = config;
        this.#roots = roots;
        this.#rootsByAlias = new Map(roots.map((root) => [root.alias, root]));
        this.ignorePolicy = ignorePolicy;
    }
    public static async create(config: FileAccessConfig): Promise<PathAuthorizer> {
        const roots: CanonicalRoot[] = [];
        for (const entry of config.allowedRoots) {
            const absolute = path.resolve(entry.path);
            let canonical: string;
            let stat: fsSync.Stats;
            try {
                const lexicalStat = await fs.lstat(absolute);
                if (lexicalStat.isSymbolicLink())
                    throw new TunnelGPTError("SYMLINK_DENIED", `Root ${entry.alias} cannot be a symlink.`);
                canonical = await fs.realpath(absolute);
                stat = await fs.stat(canonical);
            }
            catch (error) {
                if (error instanceof TunnelGPTError)
                    throw error;
                throw new TunnelGPTError("ROOT_NOT_ALLOWED", `Configured root ${entry.alias} does not exist or cannot be accessed.`);
            }
            if (!stat.isDirectory())
                throw new TunnelGPTError("ROOT_NOT_ALLOWED", `Configured root ${entry.alias} is not a directory.`);
            roots.push(Object.freeze({ alias: entry.alias, path: canonical, display: `${entry.alias}:/` }));
        }
        const dynamicDenied: string[] = [config.configFilePath];
        if (config.logging.directory !== undefined)
            dynamicDenied.push(path.resolve(config.logging.directory));
        const ignorePolicy = new IgnorePolicy(config.additionalDenyPatterns, dynamicDenied);
        return new PathAuthorizer(config, Object.freeze(roots), ignorePolicy);
    }
    public get roots(): readonly CanonicalRoot[] {
        return this.#roots;
    }
    public getRoot(alias?: string): CanonicalRoot {
        if (this.#roots.length === 0)
            throw new TunnelGPTError("ROOT_NOT_ALLOWED", "No roots are authorized. Access is denied.");
        if (alias === undefined || alias === "") {
            if (this.#roots.length === 1)
                return this.#roots[0]!;
            throw new TunnelGPTError("INVALID_ARGUMENT", "A root alias is required when multiple roots are configured.");
        }
        const root = this.#rootsByAlias.get(alias);
        if (root === undefined)
            throw new TunnelGPTError("ROOT_NOT_ALLOWED", `Root alias is not authorized: ${alias}`);
        return root;
    }
    public parsePath(input: string, rootAlias?: string): {
        root: CanonicalRoot;
        relativeInput: string;
        absoluteCandidate: string;
    } {
        this.#validateRawPath(input);
        let selectedAlias = rootAlias;
        let pathPart = input;
        const aliasMatch = ROOT_QUALIFIED_PATH_PATTERN.exec(input);
        if (aliasMatch !== null && !WINDOWS_DRIVE.test(input)) {
            const embeddedAlias = aliasMatch[1]!;
            if (selectedAlias !== undefined && selectedAlias !== "" && selectedAlias !== embeddedAlias) {
                throw new TunnelGPTError("ROOT_NOT_ALLOWED", "Embedded root alias does not match the requested root.");
            }
            selectedAlias = embeddedAlias;
            pathPart = aliasMatch[2] ?? "";
        }
        const root = this.getRoot(selectedAlias);
        if (URL_LIKE.test(pathPart) || /^file:/iu.test(pathPart)) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "URLs and URI schemes are not file paths.");
        }
        if (WINDOWS_DEVICE.test(pathPart) || UNC_PATH.test(pathPart) || (process.platform !== "win32" && WINDOWS_DRIVE.test(pathPart))) {
            throw new TunnelGPTError("SPECIAL_FILE_DENIED", "UNC paths, foreign drive paths and device paths are denied.");
        }
        const normalizedSeparators = pathPart.replace(/[\\/]+/gu, path.sep);
        const rawSegments = normalizedSeparators.split(path.sep);
        if (rawSegments.some((segment) => /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(segment))) {
            throw new TunnelGPTError("SPECIAL_FILE_DENIED", "Reserved device names are denied.");
        }
        if (rawSegments.some((segment) => segment === "..")) {
            throw new TunnelGPTError("PATH_TRAVERSAL", "Parent traversal segments are denied.");
        }
        if (path.isAbsolute(normalizedSeparators) || WINDOWS_DRIVE.test(pathPart)) {
            throw new TunnelGPTError("PATH_OUTSIDE_ROOT", "Absolute paths are denied; use an authorized root alias.");
        }
        const absoluteCandidate = path.resolve(root.path, normalizedSeparators === "" ? "." : normalizedSeparators);
        if (!isWithin(root.path, absoluteCandidate)) {
            throw new TunnelGPTError("PATH_OUTSIDE_ROOT", "Path is outside the authorized root.");
        }
        return { root, relativeInput: normalizeRelativePath(path.relative(root.path, absoluteCandidate)), absoluteCandidate };
    }
    public async authorizeExisting(input: string, options: {
        rootAlias?: string;
        kind?: ExistingPathKind;
        applyIgnore?: boolean;
        maxBytes?: number;
    } = {}): Promise<AuthorizedPath> {
        const parsed = this.parsePath(input, options.rootAlias);
        await this.#assertNoSymlinkComponents(parsed.root, parsed.absoluteCandidate, true);
        let canonical: string;
        let stat: fsSync.Stats;
        try {
            canonical = await fs.realpath(parsed.absoluteCandidate);
            stat = await fs.stat(canonical);
        }
        catch {
            throw new TunnelGPTError("NOT_FOUND", "Path does not exist or cannot be accessed.");
        }
        if (!isWithin(parsed.root.path, canonical))
            throw new TunnelGPTError("PATH_OUTSIDE_ROOT", "Canonical path escapes the authorized root.");
        const kind = statType(stat);
        if (kind === "special" || kind === "symlink")
            throw new TunnelGPTError("SPECIAL_FILE_DENIED", "Sockets, devices, FIFOs and other special paths are denied.");
        if (options.kind !== undefined && options.kind !== "any" && kind !== options.kind) {
            throw new TunnelGPTError("TYPE_MISMATCH", `Expected ${options.kind}, found ${kind}.`);
        }
        if (kind === "file" && this.#config.rejectHardLinks && stat.nlink > 1) {
            throw new TunnelGPTError("HARDLINK_DENIED", "Files with multiple hard links are denied.");
        }
        if (kind === "file" && options.maxBytes !== undefined && stat.size > options.maxBytes) {
            throw new TunnelGPTError("LIMIT_EXCEEDED", "File exceeds the configured size limit.", { size: stat.size, maxBytes: options.maxBytes });
        }
        const relative = normalizeRelativePath(path.relative(parsed.root.path, canonical));
        await this.#assertPolicies(parsed.root, canonical, relative, kind === "directory", options.applyIgnore !== false);
        return this.#authorized(parsed.root, canonical, relative);
    }
    public async authorizeNew(input: string, options: {
        rootAlias?: string;
        applyIgnore?: boolean;
    } = {}): Promise<AuthorizedPath> {
        const parsed = this.parsePath(input, options.rootAlias);
        const parent = path.dirname(parsed.absoluteCandidate);
        await this.#assertNoSymlinkComponents(parsed.root, parent, true);
        let canonicalParent: string;
        let parentStat: fsSync.Stats;
        try {
            canonicalParent = await fs.realpath(parent);
            parentStat = await fs.stat(canonicalParent);
        }
        catch {
            throw new TunnelGPTError("NOT_FOUND", "Parent directory does not exist or cannot be accessed.");
        }
        if (!parentStat.isDirectory())
            throw new TunnelGPTError("TYPE_MISMATCH", "Parent path is not a directory.");
        if (!isWithin(parsed.root.path, canonicalParent))
            throw new TunnelGPTError("PATH_OUTSIDE_ROOT", "Canonical parent escapes the authorized root.");
        const target = path.join(canonicalParent, path.basename(parsed.absoluteCandidate));
        try {
            const existing = await fs.lstat(target);
            if (existing.isSymbolicLink())
                throw new TunnelGPTError("SYMLINK_DENIED", "Target path is a symlink.");
            throw new TunnelGPTError("CONFLICT", "Target path already exists.");
        }
        catch (error) {
            if (error instanceof TunnelGPTError)
                throw error;
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT")
                throw new TunnelGPTError("CONFLICT", "Cannot safely inspect target path.");
        }
        const relative = normalizeRelativePath(path.relative(parsed.root.path, target));
        await this.#assertPolicies(parsed.root, target, relative, false, options.applyIgnore !== false);
        return this.#authorized(parsed.root, target, relative);
    }
    public async inspectEntry(input: string, rootAlias?: string): Promise<{
        authorized: AuthorizedPath;
        stat: fsSync.Stats;
        type: string;
    }> {
        const parsed = this.parsePath(input, rootAlias);
        const parent = path.dirname(parsed.absoluteCandidate);
        await this.#assertNoSymlinkComponents(parsed.root, parent, true);
        let parentCanonical: string;
        try {
            parentCanonical = await fs.realpath(parent);
        }
        catch {
            throw new TunnelGPTError("NOT_FOUND", "Parent directory does not exist.");
        }
        if (!isWithin(parsed.root.path, parentCanonical))
            throw new TunnelGPTError("PATH_OUTSIDE_ROOT", "Canonical parent escapes the authorized root.");
        const candidate = path.join(parentCanonical, path.basename(parsed.absoluteCandidate));
        let stat: fsSync.Stats;
        try {
            stat = await fs.lstat(candidate);
        }
        catch {
            throw new TunnelGPTError("NOT_FOUND", "Path does not exist or cannot be accessed.");
        }
        const type = statType(stat);
        const relative = normalizeRelativePath(path.relative(parsed.root.path, candidate));
        await this.#assertPolicies(parsed.root, candidate, relative, type === "directory", true);
        return { authorized: this.#authorized(parsed.root, candidate, relative), stat, type };
    }
    async #assertPolicies(root: CanonicalRoot, absolutePath: string, relativePath: string, isDirectory: boolean, applyIgnore: boolean): Promise<void> {
        if (this.ignorePolicy.isHardDenied(root, absolutePath, relativePath)) {
            throw new TunnelGPTError("PATH_DENIED", "Path is denied by the non-reducible security policy.");
        }
        if (applyIgnore && await this.ignorePolicy.isIgnored(root, relativePath, isDirectory)) {
            throw new TunnelGPTError("PATH_DENIED", "Path is excluded by .gitignore or .mcpignore.");
        }
    }
    async #assertNoSymlinkComponents(root: CanonicalRoot, target: string, includeTarget: boolean): Promise<void> {
        if (!isWithin(root.path, target))
            throw new TunnelGPTError("PATH_OUTSIDE_ROOT", "Path is outside the authorized root.");
        const relative = path.relative(root.path, target);
        if (relative === "")
            return;
        const segments = relative.split(path.sep);
        let current = root.path;
        const end = includeTarget ? segments.length : Math.max(0, segments.length - 1);
        for (let index = 0; index < end; index += 1) {
            current = path.join(current, segments[index]!);
            let stat: fsSync.Stats;
            try {
                stat = await fs.lstat(current);
            }
            catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === "ENOENT" && index === end - 1)
                    return;
                throw new TunnelGPTError("NOT_FOUND", "A path component does not exist.");
            }
            if (stat.isSymbolicLink())
                throw new TunnelGPTError("SYMLINK_DENIED", "Symlink components are denied.");
            if (!stat.isDirectory() && index < end - 1)
                throw new TunnelGPTError("TYPE_MISMATCH", "A path component is not a directory.");
        }
    }
    #authorized(root: CanonicalRoot, absolutePath: string, relativePath: string): AuthorizedPath {
        const normalized = relativePath === "" ? "" : normalizeRelativePath(relativePath);
        return Object.freeze({
            root,
            absolutePath,
            relativePath: normalized,
            displayPath: normalized === "" ? `${root.alias}:/` : `${root.alias}:/${normalized}`,
        });
    }
    #validateRawPath(input: string): void {
        if (typeof input !== "string" || input.length === 0 || input.length > this.#config.limits.maxPathLength) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "Path is empty or exceeds the configured length limit.");
        }
        if (/[\0\r\n]/u.test(input))
            throw new TunnelGPTError("INVALID_ARGUMENT", "NUL and line breaks are not allowed in paths.");
        if (URL_LIKE.test(input) || /^file:/iu.test(input))
            throw new TunnelGPTError("INVALID_ARGUMENT", "URLs and URI schemes are denied.");
    }
}
export function pathIsWithin(root: string, candidate: string): boolean {
    return isWithin(root, candidate);
}
