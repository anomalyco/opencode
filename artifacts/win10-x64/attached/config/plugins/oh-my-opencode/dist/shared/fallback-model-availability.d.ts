type FallbackEntry = {
    providers: string[];
    model: string;
};
type ResolvedFallbackModel = {
    provider: string;
    model: string;
};
export declare function resolveFirstAvailableFallback(fallbackChain: FallbackEntry[], availableModels: Set<string>): ResolvedFallbackModel | null;
export declare function isAnyFallbackModelAvailable(fallbackChain: FallbackEntry[], availableModels: Set<string>): boolean;
export declare function isAnyProviderConnected(providers: string[], availableModels: Set<string>): boolean;
export {};
