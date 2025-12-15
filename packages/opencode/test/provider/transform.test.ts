import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"

const OUTPUT_TOKEN_MAX = 32000

describe("ProviderTransform.maxOutputTokens", () => {
  test("returns 32k when modelLimit > 32k", () => {
    const modelLimit = 100000
    const result = ProviderTransform.maxOutputTokens("@ai-sdk/openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(OUTPUT_TOKEN_MAX)
  })

  test("returns modelLimit when modelLimit < 32k", () => {
    const modelLimit = 16000
    const result = ProviderTransform.maxOutputTokens("@ai-sdk/openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(16000)
  })

  describe("azure", () => {
    test("returns 32k when modelLimit > 32k", () => {
      const modelLimit = 100000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/azure", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit when modelLimit < 32k", () => {
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/azure", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })
  })

  describe("bedrock", () => {
    test("returns 32k when modelLimit > 32k", () => {
      const modelLimit = 100000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/amazon-bedrock", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit when modelLimit < 32k", () => {
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/amazon-bedrock", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })
  })

  describe("anthropic without thinking options", () => {
    test("returns 32k when modelLimit > 32k", () => {
      const modelLimit = 100000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit when modelLimit < 32k", () => {
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })
  })

  describe("anthropic with thinking options", () => {
    test("returns 32k when budgetTokens + 32k <= modelLimit", () => {
      const modelLimit = 100000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit - budgetTokens when budgetTokens + 32k > modelLimit", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 30000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(20000)
    })

    test("returns 32k when thinking type is not enabled", () => {
      const modelLimit = 100000
      const options = {
        thinking: {
          type: "disabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })
  })
})

describe("ProviderTransform.message - DeepSeek reasoning content", () => {
  test("DeepSeek with tool calls includes reasoning_content in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          {
            type: "tool-call",
            toolCallId: "test",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, {
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "DeepSeek Chat",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    })

    expect(result).toHaveLength(1)
    expect(result[0].content).toEqual([
      {
        type: "tool-call",
        toolCallId: "test",
        toolName: "bash",
        input: { command: "echo hello" },
      },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think about this...")
  })

  test("DeepSeek model ID containing 'deepseek' matches (case insensitive)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          {
            type: "tool-call",
            toolCallId: "test",
            toolName: "get_weather",
            input: { location: "Hangzhou" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, {
      id: "someprovider/deepseek-reasoner",
      providerID: "someprovider",
      api: {
        id: "deepseek-reasoner",
        url: "https://api.someprovider.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "SomeProvider DeepSeek Reasoner",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    })

    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Thinking...")
  })

  test("Non-DeepSeek providers leave reasoning content unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Should not be processed" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, {
      id: "openai/gpt-4",
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      name: "GPT-4",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.03,
        output: 0.06,
        cache: { read: 0.001, write: 0.002 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
    })

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

// Helper function to create a minimal model for testing
function createModel(overrides: Partial<Provider.Model>): Provider.Model {
  return {
    id: "test-model",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
    ...overrides,
  }
}

describe("ProviderTransform.buildToolCacheOptions", () => {
  describe("Anthropic provider", () => {
    test("returns anthropic cacheControl for direct Anthropic", () => {
      const model = createModel({
        providerID: "anthropic",
        api: {
          id: "claude-3-5-sonnet",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(result.anthropic).toBeDefined()
      expect(result.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    })

    test("returns anthropic cacheControl for Claude models on other providers", () => {
      const model = createModel({
        providerID: "openrouter",
        api: {
          id: "anthropic/claude-3-5-sonnet",
          url: "https://openrouter.ai/api",
          npm: "@openrouter/ai-sdk-provider",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(result.anthropic).toBeDefined()
      expect(result.anthropic.cacheControl).toEqual({ type: "ephemeral" })
      expect(result.openrouter).toBeDefined()
      expect(result.openrouter.cache_control).toEqual({ type: "ephemeral" })
    })
  })

  describe("Amazon Bedrock provider", () => {
    test("returns bedrock cachePoint for Bedrock", () => {
      const model = createModel({
        providerID: "amazon-bedrock",
        api: {
          id: "anthropic.claude-3-5-sonnet",
          url: "https://bedrock-runtime.us-east-1.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(result.bedrock).toBeDefined()
      expect(result.bedrock.cachePoint).toEqual({ type: "ephemeral" })
    })
  })

  describe("OpenRouter provider", () => {
    test("returns openrouter cache_control for OpenRouter", () => {
      const model = createModel({
        providerID: "openrouter",
        api: {
          id: "meta-llama/llama-3-70b",
          url: "https://openrouter.ai/api",
          npm: "@openrouter/ai-sdk-provider",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(result.openrouter).toBeDefined()
      expect(result.openrouter.cache_control).toEqual({ type: "ephemeral" })
    })
  })

  describe("Google Vertex Anthropic provider", () => {
    test("returns anthropic cacheControl for Google Vertex Anthropic", () => {
      const model = createModel({
        providerID: "google-vertex-anthropic",
        api: {
          id: "claude-3-5-sonnet",
          url: "https://us-central1-aiplatform.googleapis.com",
          npm: "@ai-sdk/google-vertex-anthropic",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(result.anthropic).toBeDefined()
      expect(result.anthropic.cacheControl).toEqual({ type: "ephemeral" })
    })
  })

  describe("Providers without explicit caching", () => {
    test("returns empty object for OpenAI", () => {
      const model = createModel({
        providerID: "openai",
        api: {
          id: "gpt-4-turbo",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(Object.keys(result)).toHaveLength(0)
    })

    test("returns empty object for Google Gemini", () => {
      const model = createModel({
        providerID: "google",
        api: {
          id: "gemini-2.5-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(Object.keys(result)).toHaveLength(0)
    })

    test("returns empty object for Mistral", () => {
      const model = createModel({
        providerID: "mistral",
        api: {
          id: "mistral-large",
          url: "https://api.mistral.ai",
          npm: "@ai-sdk/mistral",
        },
      })

      const result = ProviderTransform.buildToolCacheOptions(model)

      expect(Object.keys(result)).toHaveLength(0)
    })
  })
})
