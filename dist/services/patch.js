import { TunnelGPTError } from "../core/errors.js";
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;
export function applyUnifiedPatch(original, patch) {
    if (patch.length === 0 || patch.length > 2 * 1024 * 1024 || patch.includes("\0")) {
        throw new TunnelGPTError("INVALID_ARGUMENT", "Patch is empty, contains NUL, or is too large.");
    }
    const patchLines = patch.replace(/\r\n/gu, "\n").split("\n");
    const hunks = [];
    let index = 0;
    while (index < patchLines.length && !patchLines[index].startsWith("@@ "))
        index += 1;
    while (index < patchLines.length) {
        const header = HUNK_HEADER.exec(patchLines[index]);
        if (header === null)
            throw new TunnelGPTError("INVALID_ARGUMENT", "Patch contains an invalid hunk header.");
        const oldStart = Number.parseInt(header[1], 10);
        const oldCount = header[2] === undefined ? 1 : Number.parseInt(header[2], 10);
        const newStart = Number.parseInt(header[3], 10);
        const newCount = header[4] === undefined ? 1 : Number.parseInt(header[4], 10);
        index += 1;
        const lines = [];
        while (index < patchLines.length && !patchLines[index].startsWith("@@ ")) {
            const line = patchLines[index];
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
    // "" still splits to one phantom element; an empty file has zero lines and
    // only the -0,0 insertion point is inside its range.
    const lineCount = original === "" ? 0 : source.length;
    const output = [];
    let sourceIndex = 0;
    for (const hunk of hunks) {
        // `@@ -k,0 @@` inserts AFTER line k, so a zero-count hunk's start is the
        // insertion index itself, not a 1-based line number. `@@ -0,0 @@` is
        // the before-line-1 insertion point and lands at index 0 by the same rule.
        const targetIndex = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
        if (targetIndex < sourceIndex || targetIndex > lineCount) {
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
/**
 * Patience anchors: lines occurring exactly once in each middle. Their longest
 * subsequence ordered consistently on both sides is the split skeleton — every
 * non-anchor region recurses independently, so two distant edits never merge
 * into one span of fabricated removals and additions.
 */
function diffAnchors(oldLines, oi, oj, newLines, ni, nj) {
    const oldUnique = new Map();
    for (let k = oi; k < oj; k++)
        oldUnique.set(oldLines[k], oldUnique.has(oldLines[k]) ? -1 : k);
    const newCount = new Map();
    for (let k = ni; k < nj; k++)
        newCount.set(newLines[k], (newCount.get(newLines[k]) ?? 0) + 1);
    const pairs = [];
    for (let k = ni; k < nj; k++) {
        const text = newLines[k];
        const oldIndex = oldUnique.get(text);
        if (newCount.get(text) === 1 && oldIndex !== undefined && oldIndex >= 0)
            pairs.push([oldIndex, k]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    // Longest increasing subsequence over the new-side positions.
    const tails = [];
    const prev = new Array(pairs.length).fill(-1);
    for (let i = 0; i < pairs.length; i++) {
        const value = pairs[i][1];
        let lo = 0, hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (pairs[tails[mid]][1] < value)
                lo = mid + 1;
            else
                hi = mid;
        }
        if (lo > 0)
            prev[i] = tails[lo - 1];
        if (lo === tails.length)
            tails.push(i);
        else
            tails[lo] = i;
    }
    const anchors = [];
    for (let i = tails.length === 0 ? -1 : tails[tails.length - 1]; i >= 0; i = prev[i])
        anchors.push(pairs[i]);
    return anchors.reverse();
}
/** Order-preserving line alignment: context/add/remove runs, no recursion. */
function diffRuns(oldLines, newLines) {
    const out = [];
    const stack = [
        { kind: "region", oi: 0, oj: oldLines.length, ni: 0, nj: newLines.length },
    ];
    while (stack.length > 0) {
        const frame = stack.pop();
        if (frame.kind === "emit") {
            out.push({ kind: "context", text: frame.line });
            continue;
        }
        let { oi, oj, ni, nj } = frame;
        while (oi < oj && ni < nj && oldLines[oi] === newLines[ni]) {
            out.push({ kind: "context", text: oldLines[oi] });
            oi += 1;
            ni += 1;
        }
        let suffix = 0;
        while (oi + suffix < oj && ni + suffix < nj
            && oldLines[oj - 1 - suffix] === newLines[nj - 1 - suffix])
            suffix += 1;
        const omj = oj - suffix, nmj = nj - suffix;
        // The suffix is emitted after the middles — push it first (in reverse,
        // so it pops in order) so LIFO pops it last.
        for (let k = oj - 1; k >= omj; k--)
            stack.push({ kind: "emit", line: oldLines[k] });
        if (oi === omj) {
            for (let k = ni; k < nmj; k++)
                out.push({ kind: "add", text: newLines[k] });
            continue;
        }
        if (ni === nmj) {
            for (let k = oi; k < omj; k++)
                out.push({ kind: "remove", text: oldLines[k] });
            continue;
        }
        const anchors = diffAnchors(oldLines, oi, omj, newLines, ni, nmj);
        if (anchors.length === 0) {
            for (let k = oi; k < omj; k++)
                out.push({ kind: "remove", text: oldLines[k] });
            for (let k = ni; k < nmj; k++)
                out.push({ kind: "add", text: newLines[k] });
            continue;
        }
        // Push in reverse so regions pop in document order: trailing region,
        // then for each anchor backwards its context line and the region
        // before it.
        stack.push({
            kind: "region",
            oi: anchors[anchors.length - 1][0] + 1, oj: omj,
            ni: anchors[anchors.length - 1][1] + 1, nj: nmj,
        });
        for (let a = anchors.length - 1; a >= 0; a--) {
            stack.push({ kind: "emit", line: oldLines[anchors[a][0]] });
            stack.push({
                kind: "region",
                oi: a === 0 ? oi : anchors[a - 1][0] + 1, oj: anchors[a][0],
                ni: a === 0 ? ni : anchors[a - 1][1] + 1, nj: anchors[a][1],
            });
        }
    }
    return out;
}
const DIFF_CONTEXT = 3;
/** Group change runs into hunks; gaps within 2*CONTEXT merge, wider split. */
function diffHunks(runs) {
    const hunks = [];
    let oldPos = 1, newPos = 1, i = 0;
    while (i < runs.length) {
        let change = i;
        while (change < runs.length && runs[change].kind === "context")
            change += 1;
        if (change === runs.length)
            break;
        const gap = change - i;
        const lead = Math.min(gap, DIFF_CONTEXT);
        oldPos += gap - lead;
        newPos += gap - lead;
        const oldStart = oldPos, newStart = newPos;
        const lines = [];
        let cursor = change - lead;
        let closed = false;
        while (cursor < runs.length) {
            const piece = runs[cursor];
            if (piece.kind === "context") {
                let end = cursor;
                while (end < runs.length && runs[end].kind === "context")
                    end += 1;
                const run = end - cursor;
                if (end < runs.length && run <= 2 * DIFF_CONTEXT) {
                    // A narrow unchanged gap merges the surrounding changes
                    // into one hunk — the shared context would overlap anyway.
                    for (let k = cursor; k < end; k++) {
                        lines.push(runs[k]);
                        oldPos += 1;
                        newPos += 1;
                    }
                    cursor = end;
                    continue;
                }
                const trail = Math.min(run, DIFF_CONTEXT);
                for (let k = cursor; k < cursor + trail; k++) {
                    lines.push(runs[k]);
                    oldPos += 1;
                    newPos += 1;
                }
                // Resume the scan right after the emitted context: the outer
                // loop counts the un-emitted remainder as the next hunk's
                // gap, so its own leading context is still available.
                i = cursor + trail;
                closed = true;
                break;
            }
            lines.push(piece);
            if (piece.kind !== "add")
                oldPos += 1;
            if (piece.kind !== "remove")
                newPos += 1;
            cursor += 1;
        }
        if (!closed)
            i = runs.length;
        const oldCount = lines.filter((line) => line.kind !== "add").length;
        const newCount = lines.filter((line) => line.kind !== "remove").length;
        hunks.push({
            // A zero-count header names an insertion point, not a line number:
            // `@@ -k,0 @@` inserts AFTER line k, so the start is one before the
            // next unconsumed line.
            oldStart: oldCount === 0 ? Math.max(0, oldStart - 1) : oldStart,
            oldCount,
            newStart: newCount === 0 ? Math.max(0, newStart - 1) : newStart,
            newCount,
            lines,
        });
    }
    return hunks;
}
export function createUnifiedDiff(pathLabel, before, after, maxLines = 200) {
    // Same line model applyUnifiedPatch uses: a trailing newline terminates
    // the last line rather than starting an empty one, and an empty file has
    // zero lines — the phantom element would emit a context line the file
    // does not have.
    const splitForDiff = (text) => {
        if (text === "")
            return [];
        const lines = text.replace(/\r\n/gu, "\n").split("\n");
        if (text.endsWith("\n"))
            lines.pop();
        return lines;
    };
    const oldLines = splitForDiff(before);
    const newLines = splitForDiff(after);
    const hunks = diffHunks(diffRuns(oldLines, newLines));
    let changedLines = 0;
    const body = [
        `--- a/${pathLabel}`,
        `+++ b/${pathLabel}`,
    ];
    for (const hunk of hunks) {
        body.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
        for (const line of hunk.lines) {
            body.push(`${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`);
            if (line.kind !== "context")
                changedLines += 1;
        }
    }
    const truncated = body.length > maxLines;
    return {
        diff: (truncated ? body.slice(0, maxLines).concat("... diff truncated ...") : body).join("\n"),
        truncated,
        // Only + and - lines are changes; context and headers never count.
        changedLines,
    };
}
