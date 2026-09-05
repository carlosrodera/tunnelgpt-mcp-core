import { TunnelGPTError } from "../core/errors.js";
interface HunkLine {
    readonly kind: "context" | "add" | "remove";
    readonly text: string;
}
interface Hunk {
    readonly oldStart: number;
    readonly oldCount: number;
    readonly newStart: number;
    readonly newCount: number;
    readonly lines: readonly HunkLine[];
}
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;
export function applyUnifiedPatch(original: string, patch: string): string {
    if (patch.length === 0 || patch.length > 2 * 1024 * 1024 || patch.includes("\0")) {
        throw new TunnelGPTError("INVALID_ARGUMENT", "Patch is empty, contains NUL, or is too large.");
    }
    const patchLines = patch.replace(/\r\n/gu, "\n").split("\n");
    const hunks: Hunk[] = [];
    let index = 0;
    while (index < patchLines.length && !patchLines[index]!.startsWith("@@ "))
        index += 1;
    while (index < patchLines.length) {
        const header = HUNK_HEADER.exec(patchLines[index]!);
        if (header === null)
            throw new TunnelGPTError("INVALID_ARGUMENT", "Patch contains an invalid hunk header.");
        const oldStart = Number.parseInt(header[1]!, 10);
        const oldCount = header[2] === undefined ? 1 : Number.parseInt(header[2], 10);
        const newStart = Number.parseInt(header[3]!, 10);
        const newCount = header[4] === undefined ? 1 : Number.parseInt(header[4], 10);
        index += 1;
        const lines: HunkLine[] = [];
        while (index < patchLines.length && !patchLines[index]!.startsWith("@@ ")) {
            const line = patchLines[index]!;
            if (line === "\\ No newline at end of file") {
                index += 1;
                continue;
            }
            const marker = line[0];
            if (marker !== " " && marker !== "+" && marker !== "-") {
                if (line.length === 0 && index === patchLines.length - 1) {
                    index = patchLines.length;
                    break;
                }
                throw new TunnelGPTError("INVALID_ARGUMENT", "Patch hunk contains an unsupported line.");
            }
            lines.push({ kind: marker === " " ? "context" : marker === "+" ? "add" : "remove", text: line.slice(1) });
            index += 1;
        }
        const observedOld = lines.filter((line) => line.kind !== "add").length;
        const observedNew = lines.filter((line) => line.kind !== "remove").length;
        if (observedOld !== oldCount || observedNew !== newCount) {
            throw new TunnelGPTError("INVALID_ARGUMENT", "Patch hunk counts do not match its header.");
        }
        hunks.push({ oldStart, oldCount, newStart, newCount, lines });
    }
    if (hunks.length === 0)
        throw new TunnelGPTError("INVALID_ARGUMENT", "Patch contains no hunks.");
    const hadFinalNewline = original.endsWith("\n");
    const source = original.replace(/\r\n/gu, "\n").split("\n");
    if (hadFinalNewline)
        source.pop();
    const output: string[] = [];
    let sourceIndex = 0;
    for (const hunk of hunks) {
        const targetIndex = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
        if (targetIndex < sourceIndex || targetIndex > source.length) {
            throw new TunnelGPTError("CONFLICT", "Patch hunks overlap or target an invalid range.");
        }
        output.push(...source.slice(sourceIndex, targetIndex));
        sourceIndex = targetIndex;
        for (const line of hunk.lines) {
            if (line.kind === "add") {
                output.push(line.text);
                continue;
            }
            if (source[sourceIndex] !== line.text) {
                throw new TunnelGPTError("CONFLICT", "Patch context does not match the current file.", { sourceLine: sourceIndex + 1 });
            }
            if (line.kind === "context")
                output.push(line.text);
            sourceIndex += 1;
        }
    }
    output.push(...source.slice(sourceIndex));
    return `${output.join("\n")}${hadFinalNewline ? "\n" : ""}`;
}
export function createUnifiedDiff(pathLabel: string, before: string, after: string, maxLines = 200): {
    diff: string;
    truncated: boolean;
    changedLines: number;
} {
    const oldLines = before.replace(/\r\n/gu, "\n").split("\n");
    const newLines = after.replace(/\r\n/gu, "\n").split("\n");
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix])
        prefix += 1;
    let suffix = 0;
    while (suffix < oldLines.length - prefix &&
        suffix < newLines.length - prefix &&
        oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix])
        suffix += 1;
    const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
    const newChanged = newLines.slice(prefix, newLines.length - suffix);
    const body = [
        `--- a/${pathLabel}`,
        `+++ b/${pathLabel}`,
        `@@ -${prefix + 1},${oldChanged.length} +${prefix + 1},${newChanged.length} @@`,
        ...oldChanged.map((line) => `-${line}`),
        ...newChanged.map((line) => `+${line}`),
    ];
    const truncated = body.length > maxLines;
    return {
        diff: (truncated ? body.slice(0, maxLines).concat("... diff truncated ...") : body).join("\n"),
        truncated,
        changedLines: oldChanged.length + newChanged.length,
    };
}
