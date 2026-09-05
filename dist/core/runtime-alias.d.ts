declare const RUNTIME_ALIAS_BRAND: unique symbol;
export type RuntimeAlias = string & {
    readonly [RUNTIME_ALIAS_BRAND]: true;
};
export declare const RUNTIME_ALIAS_PATTERN: RegExp;
export declare const ROOT_ALIAS_PATTERN: RegExp;
export declare const ROOT_QUALIFIED_PATH_PATTERN: RegExp;
export declare const ROOT_QUALIFIED_PATH_PREFIX_PATTERN: RegExp;
export declare function isRuntimeAlias(value: unknown): value is RuntimeAlias;
export declare function parseRuntimeAlias(value: unknown): RuntimeAlias;
export declare function isRootAlias(value: unknown): value is string;
export declare function runtimeAliasFromProfileId(profileId: string): RuntimeAlias | undefined;
export declare function allocateRuntimeAlias(profileId: string): RuntimeAlias;
export {};
