import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

const claudeModel = {
  id: "anthropic/claude-sonnet-4",
  providerID: "anthropic",
  api: {
    id: "claude-sonnet-4-20250514",
    url: "https://api.anthropic.com",
    npm: "@ai-sdk/anthropic",
  },
  name: "Claude Sonnet 4",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: true },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
  limit: { context: 200000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
} as any

describe("Thinking Block Structure", () => {
  test("Claude thinking blocks have signature field", () => {
    const claudeThinkingBlock = {
      type: "thinking",
      thinking: "Let me analyze this...",
      signature: "ErUBCkYIAxgCIkDK8Y0dcPmz8BQ4K7W9vN...",
    }

    expect(claudeThinkingBlock.type).toBe("thinking")
    expect(claudeThinkingBlock.signature).toBeDefined()
  })

  test("GLM thinking blocks have different signature format", () => {
    const glmThinkingBlock = {
      type: "thinking",
      thinking: "让我思考一下这个问题...",
      signature: "glm_sig_abc123...",
    }

    expect(glmThinkingBlock.signature).not.toMatch(/^ErUB/)
  })

  test("GLM reasoning blocks have no signature", () => {
    const glmReasoningBlock = {
      type: "reasoning",
      text: "Let me think about this step by step...",
    }

    expect(glmReasoningBlock.type).toBe("reasoning")
    expect((glmReasoningBlock as any).signature).toBeUndefined()
  })
})

describe("Model Switch - Thinking Blocks", () => {
  test("thinking blocks with signatures are converted to wrapped text", () => {
    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "User is greeting me, I should respond warmly.",
            signature: "glm_invalid_signature_12345",
          },
          { type: "text", text: "Hello! How can I help you today?" },
        ],
      },
      { role: "user", content: "What is 2+2?" },
    ] as any[]

    const claudeOptions = { thinking: { type: "enabled", budgetTokens: 16000 } }
    const transformed = ProviderTransform.message(messages, claudeModel, claudeOptions)

    const assistantMsg = transformed.find((m) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()

    const thinkingPart = (assistantMsg?.content as any[])?.find((p: any) => p.type === "thinking")
    expect(thinkingPart).toBeUndefined()

    const convertedText = (assistantMsg?.content as any[])?.find(
      (p: any) => p.type === "text" && p.text.includes("<assistant_thinking>"),
    )
    expect(convertedText).toBeDefined()
    expect(convertedText.text).toContain("User is greeting me")
  })

  test("last assistant without thinking is removed when thinking enabled (no tool calls)", () => {
    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello! How can I help you today?" }],
      },
      { role: "user", content: "What is 2+2?" },
    ] as any[]

    const claudeOptions = { thinking: { type: "enabled", budgetTokens: 16000 } }
    const transformed = ProviderTransform.message(messages, claudeModel, claudeOptions)

    const assistantMsgs = transformed.filter((m) => m.role === "assistant")
    expect(assistantMsgs.length).toBe(0)
  })

  test("reasoning blocks are converted to wrapped text for Claude", () => {
    const messages = [
      { role: "user", content: "Solve this: 2+2" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me calculate: 2 + 2 = 4" },
          { type: "text", text: "The answer is 4." },
        ],
      },
    ] as any[]

    const transformed = ProviderTransform.message(messages, claudeModel, {})

    const assistantMsg = transformed.find((m) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()

    const reasoningPart = (assistantMsg?.content as any[])?.find((p: any) => p.type === "reasoning")
    expect(reasoningPart).toBeUndefined()

    const convertedText = (assistantMsg?.content as any[])?.find(
      (p: any) => p.type === "text" && p.text.includes("<assistant_thinking>"),
    )
    expect(convertedText).toBeDefined()
    expect(convertedText.text).toContain("Let me calculate")
  })
})

describe("Tool Pairing Preservation", () => {
  test("thinking blocks converted but tool pairing preserved", () => {
    const messages = [
      { role: "user", content: "Read the file test.txt" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "I need to read this file...",
            signature: "glm_invalid_sig",
          },
          {
            type: "tool-call",
            toolCallId: "tool_123",
            toolName: "read",
            args: { path: "test.txt" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tool_123",
            result: "File contents here",
          },
        ],
      },
      { role: "user", content: "Thanks! Now what?" },
    ] as any[]

    const claudeOptions = { thinking: { type: "enabled", budgetTokens: 16000 } }
    const transformed = ProviderTransform.message(messages, claudeModel, claudeOptions)

    const assistantWithTool = transformed.find(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p: any) => p.type === "tool-call"),
    )
    const toolResult = transformed.find(
      (m) => m.role === "tool" && Array.isArray(m.content) && m.content.some((p: any) => p.type === "tool-result"),
    )

    expect(assistantWithTool).toBeDefined()
    expect(toolResult).toBeDefined()

    const toolCall = (assistantWithTool!.content as any[]).find((p: any) => p.type === "tool-call")
    const toolResultPart = (toolResult!.content as any[]).find((p: any) => p.type === "tool-result")
    expect(toolCall.toolCallId).toBe(toolResultPart.toolCallId)

    const thinkingPart = (assistantWithTool!.content as any[]).find((p: any) => p.type === "thinking")
    expect(thinkingPart).toBeUndefined()

    const convertedThinking = (assistantWithTool!.content as any[]).find(
      (p: any) => p.type === "text" && p.text.includes("<assistant_thinking>"),
    )
    expect(convertedThinking).toBeDefined()
  })

  test("assistant with tool calls is NOT removed even without thinking", () => {
    const messages = [
      { role: "user", content: "Read test.txt" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading the file..." },
          { type: "tool-call", toolCallId: "tool_456", toolName: "read", args: { path: "test.txt" } },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tool_456", result: "File contents" }],
      },
    ] as any[]

    const claudeOptions = { thinking: { type: "enabled", budgetTokens: 16000 } }
    const transformed = ProviderTransform.message(messages, claudeModel, claudeOptions)

    const assistantMsg = transformed.find((m) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()
  })
})
