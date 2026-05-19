import type { FallbackEntry } from "../../shared/model-requirements";
import type { DelegatedModelConfig } from "./types";
export declare function resolveEffectiveFallbackEntry(input: {
    categoryModel: DelegatedModelConfig | undefined;
    configuredFallbackChain: FallbackEntry[] | undefined;
    resolution: {
        skipped: true;
    } | {
        fallbackEntry?: FallbackEntry;
        matchedFallback?: boolean;
    } | undefined;
}): FallbackEntry | undefined;
