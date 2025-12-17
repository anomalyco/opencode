import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

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
      release_date: "2023-04-01",
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
      release_date: "2023-04-01",
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
      release_date: "2023-04-01",
    })

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("ProviderTransform.message - Claude tool interleaving", () => {
  const mockClaudeModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
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
  } as any

  test("interleaves tool-call/tool-result for Claude", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Starting" },
          { type: "tool-call", toolCallId: "bad:id", toolName: "bash", input: { command: "echo 1" } },
          { type: "tool-call", toolCallId: "ok", toolName: "bash", input: { command: "echo 2" } },
          { type: "text", text: "After calls" },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "bad:id", toolName: "bash", output: { ok: true } },
          { type: "tool-result", toolCallId: "ok", toolName: "bash", output: { ok: true } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    expect(result).toHaveLength(3)
    expect(result[0].role).toBe("assistant")
    expect(result[1].role).toBe("tool")
    expect(result[2].role).toBe("assistant")

    const assistantParts = result[0].content as any[]
    const firstToolCallIndex = assistantParts.findIndex((p) => p.type === "tool-call")
    expect(firstToolCallIndex).toBeGreaterThanOrEqual(0)
    expect(assistantParts.slice(firstToolCallIndex).every((p) => p.type === "tool-call")).toBe(true)

    const toolCalls = assistantParts.filter((p) => p.type === "tool-call")
    expect(toolCalls.map((p) => p.toolCallId)).toEqual(["bad_id", "ok"])

    const toolResults = result[1].content as any[]
    expect(toolResults).toHaveLength(toolCalls.length)
    expect(toolResults.every((p) => p.type === "tool-result")).toBe(true)
    expect(toolResults.map((p) => p.toolCallId)).toEqual(toolCalls.map((p) => p.toolCallId))

    const afterParts = result[2].content as any[]
    expect(afterParts).toEqual([{ type: "text", text: "After calls" }])
  })

  test("moves synthetic attachment user messages after interleaving", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Starting" },
          { type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } },
          { type: "tool-call", toolCallId: "b", toolName: "bash", input: { command: "echo 2" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Tool bash returned an attachment:" },
          { type: "file", url: "file://example", mediaType: "text/plain", filename: "out.txt" },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } },
          { type: "tool-result", toolCallId: "b", toolName: "bash", output: { ok: true } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    expect(result).toHaveLength(3)
    expect(result[0].role).toBe("assistant")
    expect(result[1].role).toBe("tool")
    expect(result[2].role).toBe("user")

    const assistantParts = result[0].content as any[]
    const firstToolCallIndex = assistantParts.findIndex((p) => p.type === "tool-call")
    expect(firstToolCallIndex).toBeGreaterThanOrEqual(0)
    expect(assistantParts.slice(firstToolCallIndex).every((p) => p.type === "tool-call")).toBe(true)

    const toolCalls = assistantParts.filter((p) => p.type === "tool-call")
    expect(toolCalls.map((p) => p.toolCallId)).toEqual(["a", "b"])

    const toolResults = result[1].content as any[]
    expect(toolResults).toHaveLength(2)
    expect(toolResults.map((p) => p.type)).toEqual(["tool-result", "tool-result"])
    expect(toolResults.map((p) => p.toolCallId)).toEqual(["a", "b"])

    expect((result[2].content as any[])[0].text).toContain("returned an attachment")
  })

  test("does not interleave if tool results include extra ids", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } },
          { type: "tool-call", toolCallId: "b", toolName: "bash", input: { command: "echo 2" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } },
          { type: "tool-result", toolCallId: "b", toolName: "bash", output: { ok: true } },
          { type: "tool-result", toolCallId: "c", toolName: "bash", output: { ok: true } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("assistant")
    expect(result[1].role).toBe("tool")
    expect(result[1].content).toHaveLength(3)
  })

  test("merges split tool results across multiple tool messages", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } },
          { type: "tool-call", toolCallId: "b", toolName: "bash", input: { command: "echo 2" } },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "b", toolName: "bash", output: { ok: true } }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("assistant")
    expect(result[1].role).toBe("tool")

    const toolResults = result[1].content as any[]
    expect(toolResults.map((p) => p.toolCallId)).toEqual(["a", "b"])
  })

  test("does not interleave if tool message contains non tool-result parts", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } },
          { type: "text", text: "after" },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } },
          { type: "text", text: "bad" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("assistant")
    expect(result[1].role).toBe("tool")

    const parts = result[0].content as any[]
    const toolCallIndex = parts.findIndex((p) => p.type === "tool-call")
    expect(toolCallIndex).toBeGreaterThanOrEqual(0)
    expect(parts[toolCallIndex + 1].type).toBe("text")
  })

  test("does not interleave if tool results contain duplicate ids", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } }],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } },
          { type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    expect(result).toHaveLength(2)
    expect(result[1].content).toHaveLength(2)
  })

  test("does not move user message that only mentions attachment", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Tool bash returned an attachment:" }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    expect(result).toHaveLength(3)
    expect(result[1].role).toBe("user")
  })

  test("avoids toolCallId collisions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "bad:id", toolName: "bash", input: { command: "echo 1" } },
          { type: "tool-call", toolCallId: "bad_id", toolName: "bash", input: { command: "echo 2" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "bad:id", toolName: "bash", output: { ok: true } },
          { type: "tool-result", toolCallId: "bad_id", toolName: "bash", output: { ok: true } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    const assistantParts = result[0].content as any[]
    const calls = assistantParts.filter((p) => p.type === "tool-call")
    expect(calls).toHaveLength(2)

    const callIds = calls.map((p) => p.toolCallId)
    expect(callIds).toHaveLength(2)
    expect(callIds[0]).not.toBe(callIds[1])

    const toolMsg = result[1]
    expect(toolMsg.role).toBe("tool")

    const results = toolMsg.content as any[]
    expect(results.map((p) => p.toolCallId)).toEqual(callIds)
  })

  test("is idempotent", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } },
          { type: "text", text: "after" },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } }],
      },
    ] as any[]

    const first = ProviderTransform.message(msgs, mockClaudeModel)
    const second = ProviderTransform.message(first as any, mockClaudeModel)
    expect(second).toEqual(first)
  })

  test("skips normalization if last assistant message contains thinking blocks", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "thinking", signature: "sig", thinking: "hmm" },
          { type: "tool-call", toolCallId: "a", toolName: "bash", input: { command: "echo 1" } },
          { type: "text", text: "trailing text" },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "a", toolName: "bash", output: { ok: true } }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockClaudeModel) as any[]

    // Should NOT have normalized (split/moved) because of thinking block
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe("assistant")
    expect(result[0].content).toHaveLength(3)
    expect((result[0].content as any)[2].text).toBe("trailing text")
  })
})

describe("ProviderTransform.message - empty image handling", () => {
  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
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
  } as any

  test("should replace empty base64 image with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: "data:image/png;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel)

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })

  test("should keep valid base64 images unchanged", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel)

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
  })

  test("should handle mixed valid and empty images", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these images" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
          { type: "image", image: "data:image/jpeg;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel)

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Compare these images" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
    expect(result[0].content[2]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })
})
