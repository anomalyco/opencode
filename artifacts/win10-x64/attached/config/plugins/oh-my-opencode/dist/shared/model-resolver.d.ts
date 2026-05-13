import type { FallbackEntry } from "./model-requirements";
import type { FallbackModelObject } from "../config/schema/fallback-models";
export type ModelResolutionInput = {
    userModel?: string;
    inheritedModel?: string;
    systemDefault?: string;
};
export type ModelSource = "override" | "category-default" | "provider-fallback" | "system-default";
export type ModelResolutionResult = {
    model: string;
    source: ModelSource;
    variant?: string;
};
export type ExtendedModelResolutionInput = {
    uiSelectedModel?: string;
    userModel?: string;
    userFallbackModels?: string[];
    categoryDefaultModel?: string;
    fallbackChain?: FallbackEntry[];
    availableModels: Set<string>;
    systemDefaultModel?: string;
};
export declare function resolveModel(input: ModelResolutionInput): string | undefined;
export declare function resolveModelWithFallback(input: ExtendedModelResolutionInput): ModelResolutionResult | undefined;
/**
 * Normalizes fallback_models config to a mixed array.
 * Accepts string, string[], or mixed arrays of strings and FallbackModelObject entries.
 */
export declare function normalizeFallbackModels(models: string | (string | FallbackModelObject)[] | undefined): (string | FallbackModelObject)[] | undefined;
/**
 * Extracts plain model strings from a mixed fallback models array.
 * Object entries are flattened to "model" or "model(variant)" strings.
 * Use this when consumers need string[] (e.g., resolveModelForDelegateTask).
 */
export declare function flattenToFallbackModelStrings(models: (string | FallbackModelObject)[] | undefined): string[] | undefined;
