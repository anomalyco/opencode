// AI SDK Provider Adapter — bridges the existing LLM infrastructure to the engine's DAGGenerator
// Import this from packages/fengru and pass it to LLMDAGGenerator.setProvider()

import type { ProviderAdapter } from "./llm-dag-generator"

export function createAISDKProviderAdapter(providerOptions?: {
  apiKey?: string
  model?: string
  baseURL?: string
}): ProviderAdapter {
  return {
    chat: async ({ messages }) => {
      const { generateText } = await import("ai")
      const { createOpenAI } = await import("@ai-sdk/openai")

      const openai = createOpenAI({
        apiKey: providerOptions?.apiKey ?? process.env.OPENAI_API_KEY ?? "",
        baseURL: providerOptions?.baseURL ?? process.env.OPENAI_BASE_URL,
      })

      const model = openai(providerOptions?.model ?? "gpt-4o")

      const result = await generateText({
        model,
        messages: messages as any,
        temperature: 0.3,
        maxOutputTokens: 4000,
      })

      return { content: result.text }
    },
  }
}

// Anthropic provider adapter
export function createAnthropicProviderAdapter(providerOptions?: {
  apiKey?: string
  model?: string
}): ProviderAdapter {
  return {
    chat: async ({ messages }) => {
      const { generateText } = await import("ai")
      const { createAnthropic } = await import("@ai-sdk/anthropic")

      const anthropic = createAnthropic({
        apiKey: providerOptions?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      })

      const model = anthropic(providerOptions?.model ?? "claude-sonnet-4-20250514")

      const result = await generateText({
        model,
        messages: messages as any,
        temperature: 0.3,
        maxOutputTokens: 4000,
      })

      return { content: result.text }
    },
  }
}

// Factory: auto-detect provider from env vars
export function createAutoProviderAdapter(): ProviderAdapter {
  if (process.env.ANTHROPIC_API_KEY) {
    return createAnthropicProviderAdapter()
  }
  if (process.env.OPENAI_API_KEY) {
    return createAISDKProviderAdapter()
  }
  // Fallback: return null adapter that throws
  return {
    chat: async () => {
      throw new Error("No LLM provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.")
    },
  }
}
