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
}

/**
 * Create an OpenAI Compatible provider instance.
 * [MODIFIED] Added Protocol Fix for missing 'finish_reason: stop' in non-standard streams (e.g. APISIX/Shenma).
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

  // ==================================================================================
  // [START] PROTOCOL FIX: Custom Fetch Interceptor
  // This intercepts the stream to ensure a valid 'finish_reason: stop' signal is sent
  // before the stream closes, preventing infinite retries on strict clients.
  // ==================================================================================
  const createCompatibleFetch = (): FetchFunction => {
    // Get the original fetch (prefer user-provided, fallback to global)
    const originalFetch = options.fetch ?? (globalThis.fetch as unknown as FetchFunction);

    return async (input: RequestInfo | URL, init?: RequestInit) => {
      // 1. Execute the original request
      const response = await originalFetch(input, init);

      // If it's not a streaming response or the request failed, return immediately.
      if (!response.body || !response.ok) {
        return response;
      }

      // 2. Prepare stream interception tools
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      // 3. Create a new stream to replace the original one
      const newStream = new ReadableStream({
        async start(controller) {
          let hasSentStop = false;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunkStr = decoder.decode(value, { stream: true });

              // === Core Fix Logic: Detect [DONE] ===
              if (chunkStr.includes('[DONE]')) {
                // Check if the current chunk already contains a standard stop signal
                const isStandardStop = chunkStr.includes('"finish_reason":"stop"') || 
                                     chunkStr.includes('"finish_reason": "stop"');
                
                // If the server didn't send a stop signal, and we haven't injected one yet, do it now.
                if (!isStandardStop && !hasSentStop) {
                   // Construct a standard OpenAI stop packet
                   const fixData = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n';
                   controller.enqueue(encoder.encode(fixData));
                   hasSentStop = true;
                }
              }

              // Forward original data downstream
              controller.enqueue(value);
            }
          } catch (err) {
            controller.error(err);
          } finally {
            controller.close();
            reader.releaseLock();
          }
        }
      });

      // 4. Return the wrapped Response
      return new Response(newStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  }

  // Initialize the custom fetch implementation
  const customFetch = createCompatibleFetch();
  // ==================================================================================
  // [END] PROTOCOL FIX
  // ==================================================================================

  const createChatModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.chat`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: customFetch, // <--- [MODIFIED] Force usage of customFetch
    })
  }

  const createResponsesModel = (modelId: OpenaiCompatibleModelId) => {
    return new OpenAIResponsesLanguageModel(modelId, {
      provider: `${options.name ?? "openai-compatible"}.responses`,
      headers: getHeaders,
      url: ({ path }) => `${baseURL}${path}`,
      fetch: customFetch, // <--- [MODIFIED] Force usage of customFetch
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
