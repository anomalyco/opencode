import type { FallbackEntry } from "../shared/model-requirements";
import type { ProviderAvailability } from "./model-fallback-types";
export declare function resolveModelFromChain(fallbackChain: FallbackEntry[], availability: ProviderAvailability): {
    model: string;
    variant?: string;
} | null;
export declare function getSisyphusFallbackChain(): FallbackEntry[];
export declare function isAnyFallbackEntryAvailable(fallbackChain: FallbackEntry[], availability: ProviderAvailability): boolean;
export declare function isRequiredModelAvailable(requiresModel: string, fallbackChain: FallbackEntry[], availability: ProviderAvailability): boolean;
export declare function isRequiredProviderAvailable(requiredProviders: string[], availability: ProviderAvailability): boolean;
