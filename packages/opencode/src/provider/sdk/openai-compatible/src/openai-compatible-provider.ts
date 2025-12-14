import type { LanguageModelV2, EmbeddingModelV2, ImageModelV2 } from "@ai-sdk/provider"
import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel,
} from "@ai-sdk/openai-compatible"
import { type FetchFunction, withoutTrailingSlash, withUserAgentSuffix } from "@ai-sdk/provider-utils"
import { OpenAIResponsesLanguageModel } from "./responses/openai-responses-language-model"
import { OpenAICompatibleChatWithReasoningLanguageModel } from "./openai-compatible-chat-reasoning-model"

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
  textEmbeddingModel(modelId: OpenaiCompatibleModelId): EmbeddingModelV2<string>
  imageModel(modelId: OpenaiCompatibleModelId): ImageModelV2
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

  // Helper to create common model config
  const getCommonModelConfig = (modelType: string) => ({
    provider: `${options.name ?? "openai-compatible"}.${modelType}`,
    headers: getHeaders,
    url: ({ path }: { path: string }) => `${baseURL}${path}`,
    fetch: options.fetch,
  })

  const createChatModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAICompatibleChatWithReasoningLanguageModel(modelId, getCommonModelConfig("chat"))
  }

  const createResponsesModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAIResponsesLanguageModel(modelId, getCommonModelConfig("responses"))
  }

  const createEmbeddingModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAICompatibleEmbeddingModel(modelId, getCommonModelConfig("embedding"))
  }

  const createImageModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAICompatibleImageModel(modelId, getCommonModelConfig("image"))
  }

  const createLanguageModel = (modelId: OpenaiCompatibleModelId) => createChatModel(modelId)

  const provider = function (modelId: OpenaiCompatibleModelId) {
    return createChatModel(modelId)
  }

  provider.languageModel = createLanguageModel
  provider.chat = createChatModel
  provider.responses = createResponsesModel
  provider.textEmbeddingModel = createEmbeddingModel
  provider.imageModel = createImageModel

  return provider as OpenaiCompatibleProvider
}

// Default OpenAI Compatible provider instance
export const openaiCompatible = createOpenaiCompatible()
