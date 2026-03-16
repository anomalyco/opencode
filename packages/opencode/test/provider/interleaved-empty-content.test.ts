import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

// Model with interleaved reasoning (object form with field property)
const interleavedBedrockModel = {
  id: "amazon-bedrock/zai.glm-4.7",
  providerID: "amazon-bedrock",
  api: {
    id: "zai.glm-4.7",
    url: "https://bedrock-runtime.us-east-1.amazonaws.com",
    npm: "@ai-sdk/amazon-bedrock",
  },
  name: "GLM 4.7",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: { field: "reasoning_content" },
  },
  cost: { input: 0.001, output: 0.002, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2025-01-01",
} as any

const interleavedOpenAICompatModel = {
  ...interleavedBedrockModel,
  id: "custom/kimi-k2.5",
  providerID: "custom",
  api: {
    id: "kimi-k2.5",
    url: "https://custom-endpoint.example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Kimi K2.5",
} as any

describe("interleaved reasoning - empty content safety net", () => {
  test("drops assistant message when only reasoning parts are stripped by interleaved filter", () => {
    const msgs = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Let me think about this..." }],
      },
      { role: "user", content: "go on" },
    ] as any[]

    const result = ProviderTransform.message(msgs, interleavedBedrockModel, {})

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: "user", content: "hello" })
    expect(result[1]).toEqual({ role: "user", content: "go on" })
  })

  test("drops assistant message when multiple reasoning-only parts are stripped", () => {
    const msgs = [
      { role: "user", content: "analyze this code" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "First, let me look at the structure..." },
          { type: "reasoning", text: "I see several patterns here..." },
        ],
      },
      { role: "user", content: "what did you find?" },
    ] as any[]

    const result = ProviderTransform.message(msgs, interleavedBedrockModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("analyze this code")
    expect(result[1].content).toBe("what did you find?")
  })

  test("drops reasoning-only assistant message for openai-compatible provider", () => {
    const msgs = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Thinking..." }],
      },
      { role: "user", content: "continue" },
    ] as any[]

    const result = ProviderTransform.message(msgs, interleavedOpenAICompatModel, {})

    expect(result).toHaveLength(2)
    expect(result.every((m) => m.role === "user")).toBe(true)
  })

  test("keeps assistant message when reasoning + text content remains after filter", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think..." },
          { type: "text", text: "Here is my answer." },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, interleavedBedrockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toEqual([{ type: "text", text: "Here is my answer." }])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think...")
  })

  test("keeps assistant message when reasoning + tool-call content remains after filter", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "I should read this file..." },
          { type: "tool-call", toolCallId: "tc_1", toolName: "read", input: { path: "/foo" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, interleavedBedrockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({
      type: "tool-call",
      toolCallId: "tc_1",
      toolName: "read",
      input: { path: "/foo" },
    })
  })

  test("does not affect non-interleaved models", () => {
    const nonInterleavedModel = {
      ...interleavedBedrockModel,
      capabilities: {
        ...interleavedBedrockModel.capabilities,
        interleaved: true,
      },
    } as any

    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Let me think..." }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, nonInterleavedModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Let me think..." })
  })
})
