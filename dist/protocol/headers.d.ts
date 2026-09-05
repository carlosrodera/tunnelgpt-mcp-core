export interface HeaderOptions {
    readonly mirroredParameters?: readonly string[];
}
export type HeaderResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: number;
    readonly httpStatus: number;
    readonly message: string;
};
export declare function encodeSentinel(value: string): string;
interface RequestBody {
    readonly method?: string;
    readonly protocolVersion?: string;
    readonly params?: {
        name?: string;
        uri?: string;
        [key: string]: unknown;
    };
}
export declare function validateMirroredHeaders(headers: Record<string, string>, body: RequestBody, options?: HeaderOptions): HeaderResult;
export {};
