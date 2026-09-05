import type { KeyRing } from "../core/key-ring.js";
export const INPUT_REQUIRED = "input_required" as const;
export interface InterimResult {
    readonly kind: typeof INPUT_REQUIRED;
    readonly prompt: string;
    readonly retryToken: string;
}
export interface RetryClaim {
    readonly idempotencyIdentity: string;
    readonly toolIdentity: string;
    readonly expiresAt: number;
}
export type RetryResolution = {
    readonly ok: true;
    readonly claim: RetryClaim;
} | {
    readonly ok: false;
    readonly reason: "RETRY_MALFORMED" | "RETRY_INVALID" | "RETRY_EXPIRED" | "RETRY_TOOL_MISMATCH";
};
export class MultiRoundTripCodec {
    readonly #keyRing: KeyRing;
    readonly #now: () => number;
    public constructor(options: {
        keyRing: KeyRing;
        now: () => number;
    }) {
        this.#keyRing = options.keyRing;
        this.#now = options.now;
    }
    public requestInput(input: {
        readonly prompt: string;
        readonly idempotencyIdentity: string;
        readonly toolIdentity: string;
        readonly ttlMs: number;
    }): InterimResult {
        const payload = JSON.stringify({
            idempotencyIdentity: input.idempotencyIdentity,
            toolIdentity: input.toolIdentity,
            expiresAt: this.#now() + input.ttlMs,
        });
        const encoded = Buffer.from(payload, "utf8").toString("base64url");
        const { keyId, mac } = this.#keyRing.sign(encoded);
        return { kind: INPUT_REQUIRED, prompt: input.prompt, retryToken: `${encoded}.${keyId}.${mac}` };
    }
    public resolveRetry(token: string, toolIdentity: string): RetryResolution {
        const parts = token.split(".");
        if (parts.length !== 3)
            return { ok: false, reason: "RETRY_MALFORMED" };
        const [encoded, keyId, mac] = parts as [
            string,
            string,
            string
        ];
        if (!this.#keyRing.verify(encoded, keyId, mac))
            return { ok: false, reason: "RETRY_INVALID" };
        let payload: RetryClaim;
        try {
            payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as RetryClaim;
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
