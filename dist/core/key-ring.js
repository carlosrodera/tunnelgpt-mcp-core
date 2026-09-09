import { createHmac, timingSafeEqual } from "node:crypto";
const RETAINED_PREVIOUS_KEYS = 1;
export class KeyRing {
    #current;
    #previous;
    constructor(keys) {
        const [current, ...rest] = keys;
        if (!current)
            throw new Error("a key ring requires at least one key");
        this.#current = current;
        this.#previous = rest.slice(0, RETAINED_PREVIOUS_KEYS);
    }
    get currentKeyId() {
        return this.#current.id;
    }
    rotate(next) {
        this.#previous = [this.#current, ...this.#previous].slice(0, RETAINED_PREVIOUS_KEYS);
        this.#current = next;
    }
    sign(payload) {
        return { keyId: this.#current.id, mac: this.#mac(this.#current, payload) };
    }
    static #CANONICAL_HEX = /^[0-9a-f]+$/;
    verify(payload, keyId, mac) {
        const candidate = [this.#current, ...this.#previous].find((k) => k.id === keyId);
        if (!candidate)
            return false;
        const expected = this.#mac(candidate, payload);
        if (mac.length !== expected.length || !KeyRing.#CANONICAL_HEX.test(mac))
            return false;
        return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(mac, "hex"));
    }
    #mac(key, payload) {
        return createHmac("sha256", key.key).update(payload, "utf8").digest("hex");
    }
}
