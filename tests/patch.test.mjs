import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyUnifiedPatch } from '../dist/services/patch.js';
import { PathAuthorizer } from '../dist/core/path-authorizer.js';
import { SafeReader } from '../dist/services/safe-reader.js';
import { AtomicWriter } from '../dist/services/atomic-writer.js';
import { SignedTokenCodec } from '../dist/core/cursor.js';

// Unified diff semantics: `@@ -k,0 @@` is an insertion point AFTER line k, and
// `@@ -0,0 @@` inserts before line 1. The oldStart field is only a 1-based line
// number when the hunk consumes lines (oldCount > 0). Applying `start - 1` to a
// zero-count hunk inserts one line early — observed live: `@@ -2,0 +3,1 @@` "+C"
// on "A\nB\n" produced "A\nC\nB\n" instead of "A\nB\nC\n".

test('zero-count hunk inserts after the named line: beginning, interior, end', () => {
    assert.equal(applyUnifiedPatch('A\n', '@@ -0,0 +1 @@\n+X\n'), 'X\nA\n', 'insert before line 1');
    assert.equal(applyUnifiedPatch('A\nB\n', '@@ -1,0 +2 @@\n+X\n'), 'A\nX\nB\n', 'insert after line 1');
    assert.equal(applyUnifiedPatch('A\nB\n', '@@ -2,0 +3,1 @@\n+C\n'), 'A\nB\nC\n', 'append after the last line');
});

test('zero-count hunk fills an empty file and rejects a range the file does not have', () => {
    assert.equal(applyUnifiedPatch('', '@@ -0,0 +1 @@\n+C\n'), 'C\n', 'first line of an empty file');
    assert.throws(() => applyUnifiedPatch('', '@@ -1,0 +2 @@\n+C\n'), { code: 'CONFLICT' },
        'line 1 does not exist in an empty file');
    assert.throws(() => applyUnifiedPatch('A\nB\n', '@@ -3,0 +4 @@\n+C\n'), { code: 'CONFLICT' },
        'insert after a line beyond the end');
});

test('ordinary substitution, removal and multiple hunks keep their positions', () => {
    const original = 'one\ntwo\nthree\nfour\n';
    const patch = '@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n@@ -4,1 +4,0 @@\n-four\n';
    assert.equal(applyUnifiedPatch(original, patch), 'ONE\ntwo\nthree\n');
    assert.equal(applyUnifiedPatch('a\nb\nc\n', '@@ -2,1 +2,0 @@\n-b\n'), 'a\nc\n', 'pure removal');
    assert.equal(applyUnifiedPatch('a\nb\nc\n', '@@ -0,0 +1 @@\n+x\n@@ -3,0 +4 @@\n+y\n'), 'x\na\nb\nc\ny\n',
        'two insertions at different boundaries in one patch');
});

test('context and range must match the real content', () => {
    assert.throws(() => applyUnifiedPatch('A\nB\n', '@@ -1,2 +1,2 @@\n A\n-WRONG\n+B2\n'), { code: 'CONFLICT' });
    assert.throws(() => applyUnifiedPatch('A\nB\n', '@@ -9,1 +9,1 @@\n-X\n+Y\n'), { code: 'CONFLICT' });
    assert.throws(() => applyUnifiedPatch('A\nB\n', '@@ -1,1 +1,1 @@\n-B\n+X\n'), { code: 'CONFLICT' },
        'context that does not match refuses before any effect');
});

test('CRLF input and missing final newline follow the file posture', () => {
    assert.equal(applyUnifiedPatch('A\nB', '@@ -2,0 +3 @@\n+C\n'), 'A\nB\nC',
        'appending to a file without a final newline adds no newline');
    // Existing contract: hunk parsing normalizes CRLF and output joins with LF.
    assert.equal(applyUnifiedPatch('A\r\nB\r\n', '@@ -2,0 +3 @@\n+C\n'), 'A\nB\nC\n');
});

async function writerProject(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-core-patch-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'project');
    await fs.mkdir(root);
    const config = { profile: 'edit_safe', allowedRoots: [{ alias: 'project', path: root }], additionalDenyPatterns: [], rejectAllSymlinks: true, rejectHardLinks: true, configFilePath: path.join(directory, 'config.json'), logging: {}, limits: { maxPathLength: 4096, maxWriteBytes: 65536, maxWriteLines: 2000, maxMoveBytes: 65536, confirmationTtlMs: 60000 } };
    const authorizer = await PathAuthorizer.create(config);
    const writer = new AtomicWriter(config, authorizer, new SafeReader(), new SignedTokenCodec(60000));
    return { root, writer };
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

test('writer applies a trailing insertion bound to the expected hash, once', async (t) => {
    const { root, writer } = await writerProject(t);
    const target = path.join(root, 'probe.txt');
    await fs.writeFile(target, 'A\nB\n');
    const patch = '@@ -2,0 +3,1 @@\n+C\n';
    const preview = await writer.applyPatch({ path: 'probe.txt', patch, expectedHash: sha256('A\nB\n') });
    assert.equal(preview.ok, true);
    assert.equal(preview.applied, false);
    assert.equal(typeof preview.confirmationToken, 'string');
    const applied = await writer.applyPatch({ path: 'probe.txt', patch, expectedHash: sha256('A\nB\n'), confirmationToken: preview.confirmationToken, confirmed: true });
    assert.equal(applied.applied, true);
    assert.equal(await fs.readFile(target, 'utf8'), 'A\nB\nC\n', 'the consumer path inserts after the last line');
    await assert.rejects(
        () => writer.applyPatch({ path: 'probe.txt', patch, expectedHash: sha256('A\nB\n'), confirmationToken: preview.confirmationToken, confirmed: true }),
        (e) => ['PRECONDITION_FAILED', 'CONFLICT'].includes(e.code),
        'replaying a consumed token cannot silently re-apply');
});
