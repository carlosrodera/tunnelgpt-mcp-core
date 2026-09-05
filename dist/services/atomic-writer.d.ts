import type { PathAuthorizer } from "../core/path-authorizer.js";
import { SignedTokenCodec } from "../core/cursor.js";
import type { FileAccessConfig } from "../core/file-access-config.js";
import { SafeReader } from "./safe-reader.js";
interface PreviewResult {
    readonly ok: true;
    readonly applied: false;
    readonly requiresConfirmation: true;
    readonly confirmationToken: string;
    readonly expectedHash?: string;
    readonly newHash?: string;
    readonly newBytes?: number;
    readonly diff?: string;
    readonly diffTruncated?: boolean;
    readonly changedLines?: number;
    readonly summary: string;
}
interface AppliedResult {
    readonly ok: true;
    readonly applied: true;
    readonly path: string;
    readonly previousHash?: string;
    readonly newHash?: string;
    readonly newBytes?: number;
    readonly diff?: string;
    readonly diffTruncated?: boolean;
    readonly changedLines?: number;
    readonly summary: string;
}
export declare class AtomicWriter {
    #private;
    constructor(config: FileAccessConfig, authorizer: PathAuthorizer, reader: SafeReader, confirmations: SignedTokenCodec);
    createTextFile(args: {
        root?: string;
        path: string;
        content: string;
        confirmationToken?: string;
        confirmed?: boolean;
    }, signal?: AbortSignal): Promise<PreviewResult | AppliedResult>;
    replaceTextRange(args: {
        root?: string;
        path: string;
        startLine: number;
        endLine: number;
        replacement: string;
        expectedHash: string;
        confirmationToken?: string;
        confirmed?: boolean;
    }, signal?: AbortSignal): Promise<PreviewResult | AppliedResult>;
    applyPatch(args: {
        root?: string;
        path: string;
        patch: string;
        expectedHash: string;
        confirmationToken?: string;
        confirmed?: boolean;
    }, signal?: AbortSignal): Promise<PreviewResult | AppliedResult>;
    createDirectory(args: {
        root?: string;
        path: string;
        confirmationToken?: string;
        confirmed?: boolean;
    }): Promise<PreviewResult | AppliedResult>;
    movePath(args: {
        root?: string;
        source: string;
        destination: string;
        expectedHash?: string;
        confirmationToken?: string;
        confirmed?: boolean;
    }, signal?: AbortSignal): Promise<PreviewResult | AppliedResult>;
}
export {};
