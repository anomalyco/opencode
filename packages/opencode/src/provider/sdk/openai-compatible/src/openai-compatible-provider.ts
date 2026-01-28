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

  /**
   * User key for authenticating requests (added as query parameter).
   */
  userKey?: string
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

  // Debug log the configuration
  console.log("[DEBUG] OpenAI Compatible Provider Config:", {
    baseURL,
    hasApiKey: !!options.apiKey,
    hasUserKey: !!options.userKey,
  })

  // Create custom fetch that forces correct headers and filters unsupported params
  const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString()
    const headers = new Headers(init?.headers)
    
    // Force set Authorization header with Bearer prefix
    if (options.apiKey) {
      headers.set("Authorization", `Bearer ${options.apiKey}`)
    }
    headers.set("Content-Type", "application/json")
    
    // Filter out unsupported parameters for LiteLLM compatibility
    let body = init?.body
    if (body && typeof body === "string") {
      try {
        const parsed = JSON.parse(body)
        // Remove parameters that LiteLLM might not support
        delete parsed.reasoning_effort
        delete parsed.tool_choice
        delete parsed.parallel_tool_calls
        body = JSON.stringify(parsed)
      } catch (e) {
        // Keep original body if parsing fails
      }
    }
    
    console.log("[DEBUG] Custom Fetch URL:", url)
    console.log("[DEBUG] Custom Fetch Body:", body?.toString().substring(0, 300))
    
    const res = await fetch(url, {
      ...init,
      headers,
      body,
    })
    console.log("[DEBUG] Response:", res.status, res.statusText)
    if (res.status >= 400) {
      const text = await res.clone().text()
      console.log("[DEBUG] Error body:", text.substring(0, 500))
    }
    return res
  }

  const getHeaders = () => ({
    ...(options.apiKey && { Authorization: `Bearer ${options.apiKey}` }),
    ...options.headers,
    "User-Agent": `ai-sdk/openai-compatible/${VERSION}`,
  })

  const createChatModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.chat`,
      headers: getHeaders,
      url: ({ path }) => {
        const url = `${baseURL}${path}`
        const finalUrl = (() => {
          if (!options.userKey) return url
          if (url.includes("?")) {
            if (url.endsWith("?") || url.endsWith("&")) {
              return `${url}user_key=${encodeURIComponent(options.userKey)}`
            } else {
              return `${url}&user_key=${encodeURIComponent(options.userKey)}`
            }
          } else {
            return `${url}?user_key=${encodeURIComponent(options.userKey)}`
          }
        })()
        console.log("[DEBUG] Chat Model URL:", finalUrl)
        return finalUrl
      },
      fetch: (async (input, init) => {
        return customFetch(input, init)
      }) as FetchFunction,
    })
  }

  const createResponsesModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAIResponsesLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.responses`,
      headers: getHeaders,
      url: ({ path }) => {
        const url = `${baseURL}${path}`
        if (!options.userKey) return url
        // Check if URL already has query parameters
        if (url.includes("?")) {
          // Check if the URL ends with '?' or '&' to avoid double symbols
          if (url.endsWith("?") || url.endsWith("&")) {
            return `${url}user_key=${encodeURIComponent(options.userKey)}`
          } else {
            return `${url}&user_key=${encodeURIComponent(options.userKey)}`
          }
        } else {
          return `${url}?user_key=${encodeURIComponent(options.userKey)}`
        }
      },
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
