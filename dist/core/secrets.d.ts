export interface SecretDetection {
    readonly type: string;
    readonly line: number;
}
export declare function detectSecretContent(text: string): SecretDetection | undefined;
export declare function redactPotentialSecrets(value: string): string;
