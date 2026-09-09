import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PathAuthorizer } from '../dist/core/path-authorizer.js';
import { SafeReader } from '../dist/services/safe-reader.js';
import { AtomicWriter } from '../dist/services/atomic-writer.js';
import { SignedTokenCodec } from '../dist/core/cursor.js';
import { KeyRing } from '../dist/core/key-ring.js';
import { RequestAdmission } from '../dist/transports/request-admission.js';
import { createCoreMcpHandler } from '../dist/transports/mcp-handler-core.js';
import { Server } from '@modelcontextprotocol/server';
async function project(t, profile = 'read_only') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-core-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'project');
    await fs.mkdir(root);
    const config = { profile, allowedRoots: [{ alias: 'project', path: root }], additionalDenyPatterns: [], rejectAllSymlinks: true, rejectHardLinks: true, configFilePath: path.join(directory, 'config.json'), logging: {}, limits: { maxPathLength: 4096, maxWriteBytes: 65536, maxWriteLines: 2000, maxMoveBytes: 65536, confirmationTtlMs: 60000 } };
    const authorizer = await PathAuthorizer.create(config), reader = new SafeReader();
    const writer = new AtomicWriter(config, authorizer, reader, new SignedTokenCodec(60000));
    return { directory, root, config, authorizer, reader, writer };
}
test('reads the selected project and rejects traversal, symlinks, hardlinks and hidden credentials', async (t) => {
    const p = await project(t);
    await fs.writeFile(path.join(p.root, 'hello.txt'), 'Hello world\n');
    const authorized = await p.authorizer.authorizeExisting('hello.txt', { kind: 'file' });
    assert.equal((await p.reader.readText(authorized, { startLine: 1, maxBytes: 1024 })).text, 'Hello world');
    await assert.rejects(() => p.authorizer.authorizeExisting('../outside.txt'), e => ['PATH_TRAVERSAL', 'PATH_OUTSIDE_ROOT'].includes(e.code));
    await fs.symlink(path.join(p.root, 'hello.txt'), path.join(p.root, 'link.txt'));
    await assert.rejects(() => p.authorizer.authorizeExisting('link.txt'), { code: 'SYMLINK_DENIED' });
    await fs.link(path.join(p.root, 'hello.txt'), path.join(p.root, 'hard.txt'));
    await assert.rejects(() => p.authorizer.authorizeExisting('hard.txt', { kind: 'file' }), { code: 'HARDLINK_DENIED' });
    await fs.mkdir(path.join(p.root, '.ssh'));
    await fs.writeFile(path.join(p.root, '.ssh', 'id_ed25519'), 'example');
    await assert.rejects(() => p.authorizer.authorizeExisting('.ssh/id_ed25519'), { code: 'PATH_DENIED' });
});
test('read-only mode does not expose an accidental write path', async (t) => {
    const p = await project(t);
    await assert.rejects(() => p.writer.createTextFile({ path: 'index.html', content: '<h1>Hello</h1>' }), { code: 'PROFILE_READ_ONLY' });
    await assert.rejects(() => fs.access(path.join(p.root, 'index.html')), { code: 'ENOENT' });
});
test('long lines outside the requested range never prevent a bounded read', async (t) => {
    const p = await project(t);
    await fs.writeFile(path.join(p.root, 'long.jsonl'), 'x'.repeat(2 * 1024 * 1024) + '\nlast record\n');
    const file = await p.authorizer.authorizeExisting('long.jsonl');
    const result = await p.reader.readText(file, { startLine: 2, maxBytes: 80 });
    assert.equal(result.text, 'last record');
    assert.equal(result.totalLines, 2);
});
test('bounded long-line pages preserve Unicode and make exact forward progress', async (t) => {
    const p = await project(t), original = 'á🚀'.repeat(120) + 'end';
    await fs.writeFile(path.join(p.root, 'unicode.txt'), original);
    const file = await p.authorizer.authorizeExisting('unicode.txt');
    let startLine = 1, startColumn = 1, collected = '', pages = 0;
    for (;;) {
        const result = await p.reader.readText(file, { startLine, startColumn, maxBytes: 47 });
        assert.ok(result.bytesReturned <= 47);
        assert.ok(!result.text.includes('\uFFFD'));
        assert.ok(result.text.length > 0);
        collected += result.text;
        if (!result.truncated) break;
        assert.ok(++pages < 100);
        startLine = result.nextStartLine;
        startColumn = result.nextStartColumn;
    }
    assert.equal(collected, original);
});
test('secrets across page boundaries are not exposed by fragment reads', async (t) => {
    const p = await project(t);
    const token = ['gh', 'p_', 'A'.repeat(36)].join('');
    await fs.writeFile(path.join(p.root, 'secret.txt'), 'x'.repeat(65530) + ' ' + token);
    const file = await p.authorizer.authorizeExisting('secret.txt');
    await assert.rejects(() => p.reader.readText(file, { startLine: 1, startColumn: 65542, maxBytes: 30 }), { code: 'SECRET_CONTENT_BLOCKED' });
});
test('git ignored outputs are accessible while explicit MCP exclusions remain denied', async (t) => {
    const p = await project(t);
    await fs.mkdir(path.join(p.root, 'outputs'));
    await fs.writeFile(path.join(p.root, '.gitignore'), 'outputs/\n');
    await fs.writeFile(path.join(p.root, 'outputs/result.txt'), 'result');
    assert.equal((await p.authorizer.authorizeExisting('outputs/result.txt')).relativePath, 'outputs/result.txt');
    await fs.writeFile(path.join(p.root, '.mcpignore'), 'outputs/\n');
    await assert.rejects(() => p.authorizer.authorizeExisting('outputs/result.txt'), { code: 'PATH_DENIED' });
});
test('tiny budgets fail with guidance and cancellation stops a long read', async (t) => {
    const p = await project(t);
    await fs.writeFile(path.join(p.root, 'budget.txt'), '🚀'.repeat(1000));
    const file = await p.authorizer.authorizeExisting('budget.txt');
    await assert.rejects(() => p.reader.readText(file, { startLine: 1, maxBytes: 1 }), e => e.code === 'LIMIT_EXCEEDED' && e.details.minimumBytes >= 7);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => p.reader.readText(file, { startLine: 1, maxBytes: 40, signal: controller.signal }));
});
test('empty lines CRLF and exact line ranges preserve numbering', async (t) => {
    const p = await project(t);
    await fs.writeFile(path.join(p.root, 'lines.txt'), '\r\nsecond\r\n\r\nlast');
    const file = await p.authorizer.authorizeExisting('lines.txt');
    const result = await p.reader.readText(file, { startLine: 2, endLine: 3, maxBytes: 100 });
    assert.equal(result.text, 'second\n');
    assert.equal(result.numberedText, '2: second\n3: ');
    assert.equal(result.totalLines, 4);
    assert.equal(result.lineEnding, 'CRLF');
    assert.equal(result.truncated, false);
});
test('editing requires the proposal token and refuses a changed proposal', async (t) => {
    const p = await project(t, 'edit_safe');
    const args = { path: 'index.html', content: '<h1>Hello</h1>' };
    const preview = await p.writer.createTextFile(args);
    assert.equal(preview.applied, false);
    await assert.rejects(() => fs.access(path.join(p.root, 'index.html')), { code: 'ENOENT' });
    await assert.rejects(() => p.writer.createTextFile({ ...args, content: 'Changed', confirmed: true, confirmationToken: preview.confirmationToken }));
    const applied = await p.writer.createTextFile({ ...args, confirmed: true, confirmationToken: preview.confirmationToken });
    assert.equal(applied.applied, true);
    assert.equal(await fs.readFile(path.join(p.root, 'index.html'), 'utf8'), args.content);
});
test('request admission is bounded, FIFO and reusable after release', async () => {
    const admission = new RequestAdmission({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 1000 });
    const first = await admission.acquire();
    assert.equal(first.kind, 'admitted');
    const waiting = admission.acquire();
    assert.equal((await admission.acquire()).kind, 'overloaded');
    first.release();
    first.release();
    const second = await waiting;
    assert.equal(second.kind, 'admitted');
    assert.equal(admission.snapshot.active, 1);
    second.release();
    assert.equal(admission.snapshot.active, 0);
    admission.close();
    assert.equal((await admission.acquire()).reason, 'shutting-down');
});
test('rotated keys retain one prior generation and reject modified signatures', () => {
    const key = (id) => ({ id, key: randomBytes(32) }), ring = new KeyRing([key('a')]), signed = ring.sign('payload');
    ring.rotate(key('b'));
    assert.equal(ring.verify('payload', signed.keyId, signed.mac), true);
    assert.equal(ring.verify('payload', signed.keyId, signed.mac + 'junk'), false);
    ring.rotate(key('c'));
    assert.equal(ring.verify('payload', signed.keyId, signed.mac), false);
});
test('a consumer supplies its own MCP tools without an application runtime', async () => {
    let created = 0;
    const handler = createCoreMcpHandler({ createServer: () => {
            created++;
            const server = new Server({ name: 'core-example', version: '0.1.0' }, { capabilities: { tools: {} } });
            server.setRequestHandler('tools/list', async () => ({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] }));
            return server;
        } });
    const reply = await handler.fetch(new Request('http://localhost/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
    assert.equal(reply.status, 200);
    assert.match(await reply.text(), /echo/);
    assert.ok(created > 0);
    await handler.close();
});
test('the headless example serves a real MCP request through a private socket', async (t) => {
    const { spawn } = await import('node:child_process');
    const { request } = await import('node:http');
    const { once } = await import('node:events');
    const p = await project(t), socket = path.join(p.directory, 'mcp.sock');
    await fs.writeFile(path.join(p.root, 'hello.txt'), 'Hello from a local project');
    const child = spawn(process.execPath, ['examples/project.mjs', p.root, socket], { stdio: ['ignore', 'pipe', 'pipe'] });
    const finished = once(child, 'exit');
    t.after(async () => { if (child.exitCode === null) {
        child.kill('SIGTERM');
        await finished;
    } });
    await Promise.race([once(child.stdout, 'data'), finished.then(() => { throw Error('example stopped before startup'); })]);
    assert.equal((await fs.stat(socket)).mode & 0o777, 0o600);
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_project_file', arguments: { path: 'hello.txt' } } });
    const body = await new Promise((resolve, reject) => {
        const req = request({ socketPath: socket, path: '/mcp', method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', 'content-length': Buffer.byteLength(payload) } }, res => {
            let text = '';
            res.on('data', chunk => text += chunk);
            res.on('end', () => res.statusCode === 200 ? resolve(text) : reject(Error('HTTP ' + res.statusCode + ':' + text)));
        });
        req.on('error', reject);
        req.end(payload);
    });
    assert.match(body, /Hello from a local project/);
});
test('the public core does not export commercial transfer or upload staging', async () => {
    const Core = await import('../dist/index.js');
    assert.equal('BinaryUploads' in Core, false);
    assert.equal(typeof Core.AtomicWriter.prototype.createBinaryFile, 'undefined');
    assert.equal(typeof Core.AtomicWriter.prototype.createBinaryData, 'undefined');
    assert.equal(typeof Core.SafeReader.prototype.readBinary, 'undefined');
});
