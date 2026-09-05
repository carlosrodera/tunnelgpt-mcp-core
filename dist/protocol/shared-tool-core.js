import { buildLegacyRequestContext } from "./legacy-2025.js";
export function coreRequestFromModern(request) {
    return { method: request.method, params: { ...(request.params ?? {}) } };
}
export function coreRequestFromLegacy(request) {
    const context = buildLegacyRequestContext(request);
    return { method: context.method, params: { ...context.params } };
}
export function createSharedToolCore(options) {
    return {
        async handle(request) {
            return options.execute(request);
        },
    };
}
