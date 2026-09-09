export const INPUT_REQUIRED = "input_required";
export class MultiRoundTripCodec {
    #keyRing;
    #now;
    constructor(options) {
        this.#keyRing = options.keyRing;
        this.#now = options.now;
    }
    requestInput(input) {
        const payload = JSON.stringify({
            idempotencyIdentity: input.idempotencyIdentity,
            toolIdentity: input.toolIdentity,
            expiresAt: this.#now() + input.ttlMs,
        });
        const encoded = Buffer.from(payload, "utf8").toString("base64url");
        const { keyId, mac } = this.#keyRing.sign(encoded);
        return { kind: INPUT_REQUIRED, prompt: input.prompt, retryToken: `${encoded}.${keyId}.${mac}` };
    }
    resolveRetry(token, toolIdentity) {
        const parts = token.split(".");
        if (parts.length !== 3)
            return { ok: false, reason: "RETRY_MALFORMED" };
        const [encoded, keyId, mac] = parts;
        if (!this.#keyRing.verify(encoded, keyId, mac))
            return { ok: false, reason: "RETRY_INVALID" };
        let payload;
        try {
            payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        }
        catch {
            return { ok: false, reason: "RETRY_MALFORMED" };
        }
        if (typeof payload.idempotencyIdentity !== "string" || payload.idempotencyIdentity.length === 0) {
            return { ok: false, reason: "RETRY_MALFORMED" };
        }
        if (payload.expiresAt <= this.#now())
            return { ok: false, reason: "RETRY_EXPIRED" };
        if (payload.toolIdentity !== toolIdentity)
            return { ok: false, reason: "RETRY_TOOL_MISMATCH" };
        return { ok: true, claim: payload };
    }
}
