export interface SigningKey {
    readonly id: string;
    readonly key: Buffer;
}
export declare class KeyRing {
    #private;
    constructor(keys: readonly SigningKey[]);
    get currentKeyId(): string;
    rotate(next: SigningKey): void;
    sign(payload: string): {
        keyId: string;
        mac: string;
    };
    verify(payload: string, keyId: string, mac: string): boolean;
}
