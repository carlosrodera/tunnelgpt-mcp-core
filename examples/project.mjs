import path from 'node:path';
import { Server } from '@modelcontextprotocol/server';
import { PathAuthorizer, SafeReader, AtomicWriter, SignedTokenCodec, UnixHttpMcpServer, createCoreMcpHandler } from '../dist/index.js';
const [directory, socket, ...flags] = process.argv.slice(2);
if (!directory || !socket)
    throw Error('Usage: node examples/project.mjs PROJECT_DIRECTORY SOCKET_PATH [--edit]');
const editing = flags.includes('--edit'), root = path.resolve(directory);
const config = { profile: editing ? 'edit_safe' : 'read_only', allowedRoots: [{ alias: 'project', path: root }], additionalDenyPatterns: ['**/.env*'], rejectAllSymlinks: true, rejectHardLinks: true, configFilePath: path.join(root, '.mcp-core.json'), logging: {}, limits: { maxPathLength: 4096, maxWriteBytes: 65536, maxWriteLines: 2000, maxMoveBytes: 65536, confirmationTtlMs: 60000 } };
const authorizer = await PathAuthorizer.create(config), reader = new SafeReader(), writer = new AtomicWriter(config, authorizer, reader, new SignedTokenCodec(60000));
const readTool = { name: 'read_project_file', description: 'Read a UTF-8 text file inside the selected project.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true } };
const writeTool = { name: 'create_project_file', description: 'Preview a new UTF-8 file. To apply the exact proposal, repeat it with its confirmation token and confirmed=true.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, confirmed: { type: 'boolean' }, confirmationToken: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false }, annotations: { readOnlyHint: false } };
const transport = new UnixHttpMcpServer({ operationTimeoutMs: 15000, createHandler: onInstance => createCoreMcpHandler({ onInstance, createServer: () => {
            const server = new Server({ name: 'project-files', version: '0.1.0' }, { capabilities: { tools: {} } });
            server.setRequestHandler('tools/list', async () => ({ tools: editing ? [readTool, writeTool] : [readTool] }));
            server.setRequestHandler('tools/call', async (request, context) => {
                const args = request.params.arguments ?? {};
                let value;
                if (request.params.name === 'read_project_file' && typeof args.path === 'string') {
                    const file = await authorizer.authorizeExisting(args.path, { kind: 'file', maxBytes: 1048576 });
                    value = await reader.readText(file, { startLine: 1, maxBytes: 65536, signal: context.mcpReq.signal });
                }
                else if (editing && request.params.name === 'create_project_file' && typeof args.path === 'string' && typeof args.content === 'string') {
                    value = await writer.createTextFile({ path: args.path, content: args.content, confirmed: args.confirmed === true, ...(typeof args.confirmationToken === 'string' ? { confirmationToken: args.confirmationToken } : {}) }, context.mcpReq.signal);
                }
                else
                    throw Error('Unknown tool or invalid arguments');
                return { content: [{ type: 'text', text: JSON.stringify(value) }] };
            });
            return server;
        } }) }, { socketPath: path.resolve(socket), maxBodyBytes: 262144, maxSessions: 1, maxConcurrentRequests: 4, maxQueuedRequests: 16, queueTimeoutMs: 5000, sessionIdleTtlMs: 30000, shutdownGraceMs: 3000 });
await transport.start();
process.stdout.write('Project MCP ready on the private Unix socket.\n');
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => { void transport.close().then(() => process.exit(0)); });
