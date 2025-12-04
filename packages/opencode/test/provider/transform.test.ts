import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import type { Provider } from "../../src/provider/provider"

const OUTPUT_TOKEN_MAX = 32000

function createModel(overrides: Partial<Provider.Model>): Provider.Model {
  return {
    id: "test-model",
    providerID: "test-provider",
    transforms: undefined,
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
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
    ...overrides,
  }
}

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

  test("DeepSeek without tool calls strips reasoning from content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          { type: "text", text: "Final answer" },
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
    expect(result[0].content).toEqual([{ type: "text", text: "Final answer" }])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
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

describe("ProviderTransform.message - Mistral transforms", () => {
  describe("transform detection", () => {
    test("matches providerID === 'mistral'", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-abc123def456", result: "done" }],
        },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ] as any[]

      const result = ProviderTransform.message(
        msgs,
        createModel({ providerID: "mistral", api: { id: "mistral-large", url: "https://api.mistral.ai", npm: "@ai-sdk/mistral" } }),
      )

      // Should insert assistant message between tool and user
      expect(result).toHaveLength(3)
      expect(result[1].role).toBe("assistant")
    })

    test("matches transforms config === 'mistral' for custom provider", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-abc123def456", result: "done" }],
        },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ] as any[]

      const result = ProviderTransform.message(
        msgs,
        createModel({
          providerID: "my-local-llm",
          transforms: "mistral",
          api: { id: "my-codestral", url: "http://localhost:8080/v1", npm: "@ai-sdk/openai-compatible" },
        }),
      )

      // Should insert assistant message between tool and user
      expect(result).toHaveLength(3)
      expect(result[1].role).toBe("assistant")
    })

    test("matches model name containing 'codestral'", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-abc123def456", result: "done" }],
        },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ] as any[]

      const result = ProviderTransform.message(
        msgs,
        createModel({
          providerID: "some-provider",
          api: { id: "codestral-latest", url: "https://api.example.com", npm: "@ai-sdk/openai-compatible" },
        }),
      )

      expect(result).toHaveLength(3)
      expect(result[1].role).toBe("assistant")
    })

    test("matches model name containing 'devstral'", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-abc123def456", result: "done" }],
        },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ] as any[]

      const result = ProviderTransform.message(
        msgs,
        createModel({
          providerID: "some-provider",
          api: { id: "devstral-small-2505", url: "https://api.example.com", npm: "@ai-sdk/openai-compatible" },
        }),
      )

      expect(result).toHaveLength(3)
      expect(result[1].role).toBe("assistant")
    })

    test("matches model name containing 'pixtral'", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-abc123def456", result: "done" }],
        },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ] as any[]

      const result = ProviderTransform.message(
        msgs,
        createModel({
          providerID: "some-provider",
          api: { id: "pixtral-large-latest", url: "https://api.example.com", npm: "@ai-sdk/openai-compatible" },
        }),
      )

      expect(result).toHaveLength(3)
      expect(result[1].role).toBe("assistant")
    })

    test("does not match unrelated provider", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-abc123def456", result: "done" }],
        },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ] as any[]

      const result = ProviderTransform.message(
        msgs,
        createModel({
          providerID: "openai",
          api: { id: "gpt-4", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
        }),
      )

      // Should NOT insert assistant message
      expect(result).toHaveLength(2)
    })
  })

  describe("tool call ID normalization", () => {
    test("normalizes tool call IDs to 9 alphanumeric characters", () => {
      const msgs = [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_abc-123-def-456", toolName: "bash", input: {} }],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, createModel({ providerID: "mistral" }))

      const content = result[0].content as any[]
      expect(content[0].toolCallId).toBe("callabc12")
    })

    test("pads short IDs with zeros", () => {
      const msgs = [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "ab", toolName: "bash", input: {} }],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, createModel({ providerID: "mistral" }))

      const content = result[0].content as any[]
      expect(content[0].toolCallId).toBe("ab0000000")
    })

    test("normalizes tool result IDs too", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call_xyz-789-abc", result: "output" }],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, createModel({ providerID: "mistral" }))

      const content = result[0].content as any[]
      expect(content[0].toolCallId).toBe("callxyz78")
    })
  })

  describe("message sequence fixing", () => {
    test("inserts assistant message between tool and user", () => {
      const msgs = [
        { role: "user", content: [{ type: "text", text: "do something" }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "abc123def", toolName: "bash", input: {} }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "abc123def", result: "done" }],
        },
        { role: "user", content: [{ type: "text", text: "thanks" }] },
      ] as any[]

      const result = ProviderTransform.message(msgs, createModel({ providerID: "mistral" }))

      expect(result).toHaveLength(5)
      expect(result[0].role).toBe("user")
      expect(result[1].role).toBe("assistant")
      expect(result[2].role).toBe("tool")
      expect(result[3].role).toBe("assistant")
      expect(result[3].content).toEqual([{ type: "text", text: "Done." }])
      expect(result[4].role).toBe("user")
    })

    test("does not insert assistant if tool is followed by assistant", () => {
      const msgs = [
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "abc123def", result: "done" }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "I see the result" }],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, createModel({ providerID: "mistral" }))

      expect(result).toHaveLength(2)
      expect(result[0].role).toBe("tool")
      expect(result[1].role).toBe("assistant")
    })
  })
})
