import type { LanguageModelV2 } from "@ai-sdk/provider";
import { type FetchFunction } from "@ai-sdk/provider-utils";
export type OpenaiCompatibleModelId = string;
export interface OpenaiCompatibleProviderSettings {
    /**
     * API key for authenticating requests.
     */
    apiKey?: string;
    /**
     * Base URL for the OpenAI Compatible API calls.
     */
    baseURL?: string;
    /**
     * Name of the provider.
     */
    name?: string;
    /**
     * Custom headers to include in the requests.
     */
    headers?: Record<string, string>;
    /**
     * Custom fetch implementation.
     */
    fetch?: FetchFunction;
}
export interface OpenaiCompatibleProvider {
    (modelId: OpenaiCompatibleModelId): LanguageModelV2;
    chat(modelId: OpenaiCompatibleModelId): LanguageModelV2;
    responses(modelId: OpenaiCompatibleModelId): LanguageModelV2;
    languageModel(modelId: OpenaiCompatibleModelId): LanguageModelV2;
}
/**
 * Create an OpenAI Compatible provider instance.
 */
export declare function createOpenaiCompatible(options?: OpenaiCompatibleProviderSettings): OpenaiCompatibleProvider;
export declare const openaiCompatible: OpenaiCompatibleProvider;
