import crypto from "node:crypto";
import { TunnelGPTError } from "./errors.js";
interface CursorEnvelope {
    readonly v: 1;
    readonly op: string;
    readonly q: string;
    readonly exp: number;
    readonly state: unknown;
}
export class SignedTokenCodec {
    readonly #key: Buffer;
    readonly #ttlMs: number;
    public constructor(ttlMs: number, key?: Buffer) {
        this.#ttlMs = ttlMs;
        this.#key = key ?? crypto.randomBytes(32);
    }
    public queryDigest(input: unknown): string {
        return crypto.createHash("sha256").update(stableStringify(input)).digest("base64url").slice(0, 32);
    }
    public encode(operation: string, queryDigest: string, state: unknown, ttlOverrideMs?: number): string {
        const envelope: CursorEnvelope = {
            v: 1,
            op: operation,
            q: queryDigest,
            exp: Date.now() + (ttlOverrideMs ?? this.#ttlMs),
            state,
        };
        const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
        const signature = crypto.createHmac("sha256", this.#key).update(payload).digest("base64url");
        return `${payload}.${signature}`;
    }
    public decode<T>(token: string, operation: string, queryDigest: string): T {
        if (typeof token !== "string" || token.length > 8192 || !token.includes(".")) {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token is invalid.");
        }
        const [payload, signature, extra] = token.split(".");
        if (payload === undefined || signature === undefined || extra !== undefined) {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token is invalid.");
        }
        const expected = crypto.createHmac("sha256", this.#key).update(payload).digest();
        let supplied: Buffer;
        try {
            supplied = Buffer.from(signature, "base64url");
        }
        catch {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token is invalid.");
        }
        if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token signature is invalid.");
        }
        let envelope: CursorEnvelope;
        try {
            envelope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CursorEnvelope;
        }
        catch {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token payload is invalid.");
        }
        if (envelope.v !== 1 || envelope.op !== operation || envelope.q !== queryDigest) {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token does not match this request.");
        }
        if (!Number.isFinite(envelope.exp) || envelope.exp < Date.now()) {
            throw new TunnelGPTError("CURSOR_EXPIRED", "Cursor or confirmation token has expired.");
        }
        return envelope.state as T;
    }
}
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
