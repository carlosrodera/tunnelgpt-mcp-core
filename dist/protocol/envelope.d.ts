export declare const LDCH_META_PREFIX: "io.ldch/";
export interface EnvelopeOptions {
    readonly requiredCapabilities: readonly string[];
    readonly emitKeys?: readonly string[];
}
export type EnvelopeResult = {
    readonly ok: true;
    readonly protocolVersion: string;
    readonly clientCapabilities: Record<string, unknown>;
    readonly clientInfo?: {
        name: string;
        version: string;
    };
    readonly traceContext?: Record<string, string>;
} | {
    readonly ok: false;
    readonly code: number;
    readonly httpStatus: number;
    readonly message: string;
    readonly data?: {
        requiredCapabilities?: readonly string[];
    };
};
export declare function validateEnvelope(params: unknown, options: EnvelopeOptions): EnvelopeResult;
