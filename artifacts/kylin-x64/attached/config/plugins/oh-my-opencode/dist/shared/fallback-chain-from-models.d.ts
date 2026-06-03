import type { FallbackEntry } from "./model-requirements";
import type { FallbackModelObject } from "../config/schema/fallback-models";
export declare function parseFallbackModelEntry(model: string, contextProviderID: string | undefined, defaultProviderID?: string): FallbackEntry | undefined;
export declare function parseFallbackModelObjectEntry(obj: FallbackModelObject, contextProviderID: string | undefined, defaultProviderID?: string): FallbackEntry | undefined;
/**
 * Find the most specific FallbackEntry whose `provider/model` is a prefix of
 * the resolved `provider/modelID`.  Longest match wins so that e.g.
 * `openai/gpt-5.4-preview` picks the entry for `openai/gpt-5.4-preview` over
 * the shorter `openai/gpt-5.4`.
 */
export declare function findMostSpecificFallbackEntry(providerID: string, modelID: string, chain: FallbackEntry[]): FallbackEntry | undefined;
export declare function buildFallbackChainFromModels(fallbackModels: string | (string | FallbackModelObject)[] | undefined, contextProviderID: string | undefined, defaultProviderID?: string): FallbackEntry[] | undefined;
