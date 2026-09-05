import type { AuthorizedPath } from "../core/file-access-config.js";
export interface ReadTextRequest {
    readonly startLine: number;
    readonly endLine?: number;
    readonly maxBytes: number;
    readonly signal?: AbortSignal;
}
export interface ReadTextResult {
    readonly path: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly totalLines: number;
    readonly numberedText: string;
    readonly text: string;
    readonly bytesReturned: number;
    readonly fileBytes: number;
    readonly sha256: string;
    readonly truncated: boolean;
    readonly nextStartLine?: number;
    readonly lineEnding: "LF" | "CRLF" | "mixed_or_none";
}
interface WholeTextRead {
    readonly text: string;
    readonly sha256: string;
    readonly fileBytes: number;
    readonly containsSecret: boolean;
}
export declare class SafeReader {
    #private;
    readText(authorized: AuthorizedPath, request: ReadTextRequest): Promise<ReadTextResult>;
    readWholeText(authorized: AuthorizedPath, maxBytes: number, signal?: AbortSignal): Promise<{
        text: string;
        sha256: string;
        fileBytes: number;
    }>;
    readForMutation(authorized: AuthorizedPath, maxBytes: number, signal?: AbortSignal): Promise<WholeTextRead>;
    sha256(authorized: AuthorizedPath, signal?: AbortSignal): Promise<string>;
}
export {};
