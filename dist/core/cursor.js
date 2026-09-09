import crypto from "node:crypto";
import { TunnelGPTError } from "./errors.js";
export class SignedTokenCodec {
    #key;
    #ttlMs;
    constructor(ttlMs, key) {
        this.#ttlMs = ttlMs;
        this.#key = key ?? crypto.randomBytes(32);
    }
    queryDigest(input) {
        return crypto.createHash("sha256").update(stableStringify(input)).digest("base64url").slice(0, 32);
    }
    encode(operation, queryDigest, state, ttlOverrideMs) {
        const envelope = {
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
    decode(token, operation, queryDigest) {
        if (typeof token !== "string" || token.length > 8192 || !token.includes(".")) {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token is invalid.");
        }
        const [payload, signature, extra] = token.split(".");
        if (payload === undefined || signature === undefined || extra !== undefined) {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token is invalid.");
        }
        const expected = crypto.createHmac("sha256", this.#key).update(payload).digest();
        let supplied;
        try {
            supplied = Buffer.from(signature, "base64url");
        }
        catch {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token is invalid.");
        }
        if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
            throw new TunnelGPTError("CURSOR_INVALID", "Cursor or confirmation token signature is invalid.");
        }
        let envelope;
        try {
            envelope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
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
        return envelope.state;
    }
}
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
