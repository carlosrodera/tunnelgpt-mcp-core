export declare const LDCH_TARGET_WIRE_ERA: "2026-07-28";
export interface RequiredCapability {
    readonly name: string;
    readonly module: "server" | "core";
    readonly why: string;
}
export declare const REQUIRED_SDK_CAPABILITIES: readonly RequiredCapability[];
export interface ProbeResult {
    readonly ok: boolean;
    readonly missing: readonly string[];
    readonly targetWireEra: typeof LDCH_TARGET_WIRE_ERA;
}
export declare function probeSdkCapabilities(sdkOverride?: Record<string, unknown>): Promise<ProbeResult>;
export declare function assertSdkCapabilities(): Promise<void>;
