export declare class SignedTokenCodec {
    #private;
    constructor(ttlMs: number, key?: Buffer);
    queryDigest(input: unknown): string;
    encode(operation: string, queryDigest: string, state: unknown, ttlOverrideMs?: number): string;
    decode<T>(token: string, operation: string, queryDigest: string): T;
}
