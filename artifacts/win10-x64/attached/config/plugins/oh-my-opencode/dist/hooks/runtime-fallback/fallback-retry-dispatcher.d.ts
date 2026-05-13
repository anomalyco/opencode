import type { AutoRetryHelpers } from "./auto-retry";
import type { HookDeps, FallbackState } from "./types";
type DispatchFallbackRetryOptions = {
    sessionID: string;
    state: FallbackState;
    fallbackModels: string[];
    resolvedAgent?: string;
    source: string;
};
export declare function dispatchFallbackRetry(deps: HookDeps, helpers: AutoRetryHelpers, options: DispatchFallbackRetryOptions): Promise<void>;
export {};
