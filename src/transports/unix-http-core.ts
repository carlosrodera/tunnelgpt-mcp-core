import fs from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import http, { type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import path from "node:path";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import type { WireEraLabel } from "./mcp-handler-core.js";
import { RequestAdmission } from "./request-admission.js";
export interface UnixHttpMcpDependencies {
    readonly operationTimeoutMs: number;
    readonly createHandler: (onInstance: (era: WireEraLabel) => void) => McpHttpHandler;
}
const MAX_UNIX_SOCKET_BYTES = 100;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
export interface UnixHttpMcpServerOptions {
    readonly socketPath: string;
    readonly maxBodyBytes: number;
    readonly maxSessions: number;
    readonly maxConcurrentRequests: number;
    readonly maxQueuedRequests?: number;
    readonly queueTimeoutMs?: number;
    readonly sessionIdleTtlMs: number;
    readonly shutdownGraceMs: number;
}
interface SocketIdentity {
    readonly dev: bigint;
    readonly ino: bigint;
}
interface ParsedBody {
    readonly value: unknown;
}
class HttpEnvelopeError extends Error {
    readonly status: number;
    readonly rpcCode: number;
    constructor(status: number, rpcCode: number, message: string) {
        super(message);
        this.name = "HttpEnvelopeError";
        this.status = status;
        this.rpcCode = rpcCode;
    }
}
function singleHeader(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name];
    if (Array.isArray(value))
        return value.length === 1 ? value[0] : undefined;
    return value;
}
function sendJson(res: ServerResponse, status: number, value: unknown, extraHeaders: Record<string, string> = {}): void {
    if (res.headersSent || res.destroyed)
        return;
    const body = `${JSON.stringify(value)}\n`;
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
        ...extraHeaders,
    });
    res.end(body);
}
function sendRpcError(res: ServerResponse, status: number, rpcCode: number, message: string): void {
    sendJson(res, status, {
        jsonrpc: "2.0",
        error: { code: rpcCode, message },
        id: null,
    });
}
function sameSocketIdentity(stat: BigIntStats, identity: SocketIdentity): boolean {
    return stat.dev === identity.dev && stat.ino === identity.ino && stat.isSocket();
}
async function lstatOrUndefined(target: string): Promise<BigIntStats | undefined> {
    try {
        return await fs.lstat(target, { bigint: true });
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw error;
    }
}
async function probeUnixSocket(socketPath: string): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: boolean): void => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const request = http.request({
            socketPath,
            path: "/healthz",
            method: "GET",
            headers: { host: "tunnelgpt.invalid", connection: "close" },
        }, (response) => {
            response.resume();
            response.once("end", () => finish(true));
            response.once("error", () => finish(true));
        });
        const timer = setTimeout(() => {
            request.destroy();
            finish(true);
        }, 500);
        timer.unref();
        request.once("error", (error: NodeJS.ErrnoException) => {
            finish(error.code !== "ECONNREFUSED" && error.code !== "ENOENT");
        });
        request.end();
    });
}
async function prepareSocketPath(socketPath: string): Promise<void> {
    if (!path.isAbsolute(socketPath) || /[\0\r\n]/u.test(socketPath) || Buffer.byteLength(socketPath) > MAX_UNIX_SOCKET_BYTES) {
        throw new Error("Unix socket path must be absolute, short, and free of control characters.");
    }
    const parent = path.dirname(socketPath);
    const parentStat = await lstatOrUndefined(parent);
    if (parentStat === undefined || !parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        throw new Error("Unix socket parent must be an existing non-symbolic directory.");
    }
    const first = await lstatOrUndefined(socketPath);
    if (first === undefined)
        return;
    if (!first.isSocket() || first.isSymbolicLink()) {
        throw new Error("Unix socket path exists and is not a socket; it was preserved.");
    }
    const identity: SocketIdentity = { dev: first.dev, ino: first.ino };
    if (await probeUnixSocket(socketPath)) {
        throw new Error("Unix socket is occupied by a listening process.");
    }
    const second = await lstatOrUndefined(socketPath);
    if (second === undefined)
        return;
    if (!sameSocketIdentity(second, identity)) {
        throw new Error("Unix socket changed during stale-state validation; it was preserved.");
    }
    await fs.unlink(socketPath);
}
async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<ParsedBody> {
    const contentLengthValue = singleHeader(req, "content-length");
    if (contentLengthValue !== undefined) {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLengthValue)) {
            throw new HttpEnvelopeError(400, -32600, "Invalid Content-Length.");
        }
        if (Number(contentLengthValue) > maxBytes) {
            req.resume();
            throw new HttpEnvelopeError(413, -32000, "Request body exceeds the configured limit.");
        }
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let tooLarge = false;
    for await (const rawChunk of req) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
        bytes += chunk.length;
        if (bytes > maxBytes) {
            tooLarge = true;
            continue;
        }
        chunks.push(chunk);
    }
    if (tooLarge)
        throw new HttpEnvelopeError(413, -32000, "Request body exceeds the configured limit.");
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    }
    catch {
        throw new HttpEnvelopeError(400, -32700, "Request body is not valid UTF-8.");
    }
    try {
        return { value: JSON.parse(text) as unknown };
    }
    catch {
        throw new HttpEnvelopeError(400, -32700, "Request body is not valid JSON.");
    }
}
function requestAcceptsMcp(req: IncomingMessage): boolean {
    const accept = singleHeader(req, "accept")?.toLocaleLowerCase("en-US") ?? "";
    return accept.includes("application/json") && accept.includes("text/event-stream");
}
function validHost(req: IncomingMessage): boolean {
    const host = singleHeader(req, "host")?.toLocaleLowerCase("en-US");
    return host === "tunnelgpt.invalid" || host === "tunnelgpt.invalid:80" ||
        host === "localhost" || host === "localhost:80";
}
function toWebRequest(req: IncomingMessage, signal?: AbortSignal): Request {
    const headers = new Headers();
    for (const [name, rawValue] of Object.entries(req.headers)) {
        if (rawValue === undefined || name === "content-length" || name === "transfer-encoding")
            continue;
        if (Array.isArray(rawValue)) {
            for (const value of rawValue)
                headers.append(name, value);
        }
        else {
            headers.set(name, rawValue);
        }
    }
    const method = req.method ?? "GET";
    return new Request(`http:${"//"}tunnelgpt.invalid${req.url ?? "/mcp"}`, {
        method,
        headers,
        ...(signal === undefined ? {} : { signal }),
        ...(method === "POST" ? { body: "{}" } : {}),
    });
}
async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
    if (res.headersSent || res.destroyed)
        return;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name] = value; });
    res.writeHead(response.status, headers);
    if (response.body === null) {
        res.end();
        return;
    }
    const reader = response.body.getReader();
    try {
        while (true) {
            if (res.destroyed || res.writableEnded)
                break;
            const result = await reader.read();
            if (result.done)
                break;
            if (!res.write(Buffer.from(result.value))) {
                await new Promise<void>((resolve) => {
                    const done = (): void => { res.off("drain", done); res.off("close", done); resolve(); };
                    res.once("drain", done);
                    res.once("close", done);
                });
            }
        }
        if (!res.destroyed && !res.writableEnded)
            res.end();
    }
    catch {
        if (!res.destroyed && !res.writableEnded)
            res.end();
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
export class UnixHttpMcpServer {
    readonly #options: UnixHttpMcpServerOptions;
    readonly #httpServer: HttpServer;
    readonly #handler: McpHttpHandler;
    readonly #admission: RequestAdmission;
    #instancesByEra: Record<WireEraLabel, number> = { legacy: 0, modern: 0 };
    #ready = false;
    #started = false;
    #closed = false;
    #socketIdentity?: SocketIdentity;
    constructor(dependencies: UnixHttpMcpDependencies, options: UnixHttpMcpServerOptions) {
        this.#options = options;
        if (!Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < 1 ||
            !Number.isSafeInteger(options.maxSessions) || options.maxSessions < 1 ||
            !Number.isSafeInteger(options.maxConcurrentRequests) || options.maxConcurrentRequests < 1 ||
            !Number.isFinite(options.sessionIdleTtlMs) || options.sessionIdleTtlMs < 1 ||
            !Number.isFinite(options.shutdownGraceMs) || options.shutdownGraceMs < 1) {
            throw new Error("Unix MCP server limits are invalid.");
        }
        this.#admission = new RequestAdmission({
            maxActive: options.maxConcurrentRequests,
            maxQueued: options.maxQueuedRequests ?? 64,
            queueTimeoutMs: options.queueTimeoutMs ?? 30000,
        });
        this.#handler = dependencies.createHandler((era) => { this.#instancesByEra[era] += 1; });
        this.#httpServer = http.createServer((req, res) => {
            void this.#handle(req, res).catch(() => {
                if (!res.destroyed && !res.headersSent)
                    sendRpcError(res, 500, -32603, "Internal server error.");
            });
        });
        this.#httpServer.maxHeadersCount = 32;
        this.#httpServer.headersTimeout = 5000;
        this.#httpServer.requestTimeout = Math.max(5000, Math.min(120000, dependencies.operationTimeoutMs + 5000));
        this.#httpServer.keepAliveTimeout = 1000;
    }
    get activeSessionCount(): number {
        return 0;
    }
    get admission(): {
        readonly active: number;
        readonly queued: number;
    } {
        return this.#admission.snapshot;
    }
    get instancesByEra(): Readonly<Record<WireEraLabel, number>> {
        return { ...this.#instancesByEra };
    }
    get ready(): boolean {
        return this.#ready;
    }
    async start(): Promise<void> {
        if (this.#started || this.#closed)
            throw new Error("Unix MCP server cannot be started twice.");
        this.#started = true;
        try {
            await prepareSocketPath(this.#options.socketPath);
            await new Promise<void>((resolve, reject) => {
                const onError = (error: Error): void => {
                    this.#httpServer.off("listening", onListening);
                    reject(error);
                };
                const onListening = (): void => {
                    this.#httpServer.off("error", onError);
                    resolve();
                };
                this.#httpServer.once("error", onError);
                this.#httpServer.once("listening", onListening);
                this.#httpServer.listen(this.#options.socketPath);
            });
            await fs.chmod(this.#options.socketPath, 0o600);
            const stat = await fs.lstat(this.#options.socketPath, { bigint: true });
            if (!stat.isSocket())
                throw new Error("Unix listener did not create a socket.");
            this.#socketIdentity = { dev: stat.dev, ino: stat.ino };
            this.#ready = true;
        }
        catch (error) {
            this.#ready = false;
            this.#closed = true;
            await this.#closeListener();
            await this.#removeOwnedSocket();
            throw error;
        }
    }
    async close(): Promise<void> {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#ready = false;
        this.#admission.close();
        try {
            await this.#handler.close();
        }
        catch { }
        await this.#closeListener();
        await this.#removeOwnedSocket();
    }
    async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        if (singleHeader(req, "origin") !== undefined) {
            sendRpcError(res, 403, -32000, "Origin is not allowed on the local transport.");
            req.resume();
            return;
        }
        if (!validHost(req)) {
            sendRpcError(res, 403, -32000, "Host is not allowed on the local transport.");
            req.resume();
            return;
        }
        if (req.url === "/healthz") {
            if (req.method !== "GET") {
                sendJson(res, 405, { status: "method_not_allowed" }, { allow: "GET" });
                req.resume();
                return;
            }
            sendJson(res, this.#ready ? 200 : 503, { status: this.#ready ? "ok" : "draining" });
            return;
        }
        if (req.url !== "/mcp") {
            sendRpcError(res, 404, -32000, "Not found.");
            req.resume();
            return;
        }
        if (req.method === "GET") {
            res.setHeader("allow", "POST");
            sendRpcError(res, 405, -32000, "Standalone SSE is not enabled.");
            req.resume();
            return;
        }
        if (req.method !== "POST" && req.method !== "DELETE") {
            res.setHeader("allow", "POST");
            sendRpcError(res, 405, -32000, "Method not allowed.");
            req.resume();
            return;
        }
        if (!this.#ready) {
            sendRpcError(res, 503, -32000, "Local MCP transport is not ready.");
            req.resume();
            return;
        }
        if (!requestAcceptsMcp(req)) {
            sendRpcError(res, 406, -32000, "Accept must include the MCP response media types.");
            req.resume();
            return;
        }
        const queueAbort = new AbortController();
        const leaveQueue = (): void => queueAbort.abort();
        req.once("aborted", leaveQueue);
        req.once("close", leaveQueue);
        const admitted = await this.#admission.acquire(queueAbort.signal);
        req.off("aborted", leaveQueue);
        req.off("close", leaveQueue);
        if (admitted.kind !== "admitted") {
            if (!res.destroyed && !res.headersSent) {
                if (admitted.retryAfterMs > 0) {
                    res.setHeader("retry-after", Math.max(1, Math.ceil(admitted.retryAfterMs / 1000)));
                }
                sendRpcError(res, 429, -32000, `Local MCP transport is busy (${admitted.reason}).`);
            }
            req.resume();
            return;
        }
        try {
            await this.#serve(req, res);
        }
        catch (error) {
            if (res.destroyed || res.headersSent) {
            }
            else if (error instanceof HttpEnvelopeError) {
                sendRpcError(res, error.status, error.rpcCode, error.message);
            }
            else {
                sendRpcError(res, 500, -32603, "Internal server error.");
            }
        }
        finally {
            admitted.release();
        }
    }
    async #serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
        let parsedBody: unknown;
        if (req.method === "POST") {
            const contentType = singleHeader(req, "content-type") ?? "";
            if (!JSON_CONTENT_TYPE.test(contentType)) {
                req.resume();
                throw new HttpEnvelopeError(415, -32000, "Content-Type must be application/json.");
            }
            parsedBody = (await readJsonBody(req, this.#options.maxBodyBytes)).value;
        }
        else {
            req.resume();
        }
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        req.once("aborted", abort);
        req.once("close", abort);
        res.once("close", abort);
        try {
            const response = await this.#handler.fetch(toWebRequest(req, controller.signal), parsedBody === undefined ? {} : { parsedBody });
            await writeWebResponse(response, res);
        }
        finally {
            req.off("aborted", abort);
            req.off("close", abort);
            res.off("close", abort);
        }
    }
    async #closeListener(): Promise<void> {
        if (!this.#httpServer.listening)
            return;
        await new Promise<void>((resolve) => {
            let settled = false;
            const done = (): void => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                this.#httpServer.closeAllConnections();
                done();
            }, this.#options.shutdownGraceMs);
            timer.unref();
            this.#httpServer.close(() => done());
        });
    }
    async #removeOwnedSocket(): Promise<void> {
        const identity = this.#socketIdentity;
        this.#socketIdentity = undefined;
        if (identity === undefined)
            return;
        const stat = await lstatOrUndefined(this.#options.socketPath);
        if (stat === undefined || !sameSocketIdentity(stat, identity))
            return;
        try {
            await fs.unlink(this.#options.socketPath);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
        }
    }
}
