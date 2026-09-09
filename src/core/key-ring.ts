import { createHmac, timingSafeEqual } from "node:crypto";
export interface SigningKey {
    readonly id: string;
    readonly key: Buffer;
}
const RETAINED_PREVIOUS_KEYS = 1;
export class KeyRing {
    #current: SigningKey;
    #previous: SigningKey[];
    public constructor(keys: readonly SigningKey[]) {
        const [current, ...rest] = keys;
        if (!current)
            throw new Error("a key ring requires at least one key");
        this.#current = current;
        this.#previous = rest.slice(0, RETAINED_PREVIOUS_KEYS);
    }
    public get currentKeyId(): string {
        return this.#current.id;
    }
    public rotate(next: SigningKey): void {
        this.#previous = [this.#current, ...this.#previous].slice(0, RETAINED_PREVIOUS_KEYS);
        this.#current = next;
    }
    public sign(payload: string): {
        keyId: string;
        mac: string;
    } {
        return { keyId: this.#current.id, mac: this.#mac(this.#current, payload) };
    }
    static readonly #CANONICAL_HEX = /^[0-9a-f]+$/;
    public verify(payload: string, keyId: string, mac: string): boolean {
        const candidate = [this.#current, ...this.#previous].find((k) => k.id === keyId);
        if (!candidate)
            return false;
        const expected = this.#mac(candidate, payload);
        if (mac.length !== expected.length || !KeyRing.#CANONICAL_HEX.test(mac))
            return false;
        return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(mac, "hex"));
    }
    #mac(key: SigningKey, payload: string): string {
        return createHmac("sha256", key.key).update(payload, "utf8").digest("hex");
    }
}
