import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { TunnelGPTError } from "../core/errors.js";
import { assertNotCancelled } from "../core/operation.js";
import type { AuthorizedPath } from "../core/file-access-config.js";
import type { PathAuthorizer } from "../core/path-authorizer.js";
export interface WalkEntry {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly displayPath: string;
    readonly name: string;
    readonly type: "file" | "directory";
    readonly size: number;
    readonly mtimeMs: number;
    readonly depth: number;
}
export interface WalkOptions {
    readonly maxDepth: number;
    readonly includeHidden: boolean;
    readonly scanBudget: number;
    readonly signal?: AbortSignal;
}
const SKIPPABLE_CODES = new Set([
    "PATH_DENIED",
    "SYMLINK_DENIED",
    "HARDLINK_DENIED",
    "SPECIAL_FILE_DENIED",
    "NOT_FOUND",
    "TYPE_MISMATCH",
    "PATH_OUTSIDE_ROOT",
]);
function sameDirectoryIdentity(left: Awaited<ReturnType<typeof fs.lstat>>, right: Awaited<ReturnType<typeof fs.lstat>>): boolean {
    return left.isDirectory() && right.isDirectory()
        && !left.isSymbolicLink() && !right.isSymbolicLink()
        && left.dev === right.dev && left.ino === right.ino;
}
export class Walker {
    readonly #authorizer: PathAuthorizer;
    public constructor(authorizer: PathAuthorizer) {
        this.#authorizer = authorizer;
    }
    public async collect(start: AuthorizedPath, options: WalkOptions): Promise<{
        entries: WalkEntry[];
        scanLimitReached: boolean;
    }> {
        const entries: WalkEntry[] = [];
        let scanned = 0;
        let scanLimitReached = false;
        const visit = async (requestedDirectory: AuthorizedPath, depth: number): Promise<void> => {
            assertNotCancelled(options.signal);
            if (scanLimitReached)
                return;
            const directory = await this.#authorizer.authorizeExisting(requestedDirectory.displayPath, {
                rootAlias: start.root.alias,
                kind: "directory",
                applyIgnore: depth !== 1,
            });
            const before = await fs.lstat(directory.absolutePath);
            if (!before.isDirectory() || before.isSymbolicLink()) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "Directory changed before it could be listed safely.");
            }
            let dirents: Dirent<string>[];
            try {
                dirents = await fs.readdir(directory.absolutePath, { withFileTypes: true });
            }
            catch {
                throw new TunnelGPTError("NOT_FOUND", "Directory cannot be listed safely.");
            }
            const after = await fs.lstat(directory.absolutePath).catch(() => undefined);
            if (after === undefined || !sameDirectoryIdentity(before, after)) {
                throw new TunnelGPTError("PRECONDITION_FAILED", "Directory changed while it was being listed.");
            }
            dirents.sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "variant" }));
            for (const dirent of dirents) {
                assertNotCancelled(options.signal);
                scanned += 1;
                if (scanned > options.scanBudget) {
                    scanLimitReached = true;
                    return;
                }
                if (/[\0\r\n]/u.test(dirent.name))
                    continue;
                if (!options.includeHidden && dirent.name.startsWith("."))
                    continue;
                if (dirent.isSymbolicLink() || (!dirent.isFile() && !dirent.isDirectory()))
                    continue;
                const relativePath = directory.relativePath === "" ? dirent.name : `${directory.relativePath}/${dirent.name}`;
                let authorized: AuthorizedPath;
                try {
                    authorized = await this.#authorizer.authorizeExisting(`${start.root.alias}:/${relativePath}`, {
                        rootAlias: start.root.alias,
                        kind: dirent.isDirectory() ? "directory" : "file",
                    });
                }
                catch (error) {
                    if (error instanceof TunnelGPTError && SKIPPABLE_CODES.has(error.code))
                        continue;
                    throw error;
                }
                let stat;
                try {
                    stat = await fs.lstat(authorized.absolutePath);
                }
                catch {
                    continue;
                }
                if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
                    continue;
                entries.push({
                    absolutePath: authorized.absolutePath,
                    relativePath: authorized.relativePath,
                    displayPath: authorized.displayPath,
                    name: dirent.name,
                    type: stat.isDirectory() ? "directory" : "file",
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                    depth,
                });
                if (stat.isDirectory() && depth < options.maxDepth) {
                    await visit(authorized, depth + 1);
                    if (scanLimitReached)
                        return;
                }
            }
        };
        await visit(start, 1);
        return { entries, scanLimitReached };
    }
}
