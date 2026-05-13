import type { DelegatedModelConfig } from "./types";
import type { FallbackEntry } from "../../shared/model-requirements";
export declare function applyFallbackEntrySettings(input: {
    categoryModel: DelegatedModelConfig;
    effectiveEntry: FallbackEntry;
    variantOverride?: string;
}): DelegatedModelConfig;
