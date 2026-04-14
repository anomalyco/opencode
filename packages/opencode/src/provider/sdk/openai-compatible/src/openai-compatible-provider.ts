import type { LanguageModelV2 } from "@ai-sdk/provider"
import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible"
import { type FetchFunction, withoutTrailingSlash, withUserAgentSuffix } from "@ai-sdk/provider-utils"
import { OpenAIResponsesLanguageModel } from "./responses/openai-responses-language-model"

// Import the version or define it
const VERSION = "0.1.0"

export type OpenaiCompatibleModelId = string

export interface OpenaiCompatibleProviderSettings {
  /**
   * API key for authenticating requests.
   */
  apiKey?: string

  /**
   * Base URL for the OpenAI Compatible API calls.
   */
  baseURL?: string

  /**
   * Name of the provider.
   */
  name?: string

  /**
   * Custom headers to include in the requests.
   */
  headers?: Record<string, string>

  /**
   * Custom fetch implementation.
   */
  fetch?: FetchFunction
}

export interface OpenaiCompatibleProvider {
  (modelId: OpenaiCompatibleModelId): LanguageModelV2
  chat(modelId: OpenaiCompatibleModelId): LanguageModelV2
  responses(modelId: OpenaiCompatibleModelId): LanguageModelV2
  languageModel(modelId: OpenaiCompatibleModelId): LanguageModelV2

  // embeddingModel(modelId: any): EmbeddingModelV2

  // imageModel(modelId: any): ImageModelV2
}

/**
 * Create an OpenAI Compatible provider instance.
 */
export function createOpenaiCompatible(options: OpenaiCompatibleProviderSettings = {}): OpenaiCompatibleProvider {
  const baseURL = withoutTrailingSlash(options.baseURL ?? "https://api.openai.com/v1")

  if (!baseURL) {
    throw new Error("baseURL is required")
  }

  // Merge headers: defaults first, then user overrides
  const headers = {
    // Default OpenAI Compatible headers (can be overridden by user)
    ...(options.apiKey && { Authorization: `Bearer ${options.apiKey}` }),
    ...options.headers,
  }

  const getHeaders = () => withUserAgentSuffix(headers, `ai-sdk/openai-compatible/${VERSION}`)

  const createChatModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.chat`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: options.fetch,
    })
  }

  const createResponsesModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAIResponsesLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.responses`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: options.fetch,
    })
  }

  const createLanguageModel = (modelId: OpenaiCompatibleModelId) => createChatModel(modelId)

  const provider = function (modelId: OpenaiCompatibleModelId) {
    return createChatModel(modelId)
  }

  provider.languageModel = createLanguageModel
  provider.chat = createChatModel
  provider.responses = createResponsesModel

  return provider as OpenaiCompatibleProvider
}

// Default OpenAI Compatible provider instance
export const openaiCompatible = createOpenaiCompatible()
