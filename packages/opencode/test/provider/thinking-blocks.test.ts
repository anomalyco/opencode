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
  test("Claude thinking blocks have valid signature starting with ErUB", () => {
    const claudeThinkingBlock = {
      type: "thinking",
      thinking: "Let me analyze this...",
      signature: "ErUBCkYIAxgCIkDK8Y0dcPmz8BQ4K7W9vN...",
    }

    expect(claudeThinkingBlock.type).toBe("thinking")
    expect(claudeThinkingBlock.signature).toMatch(/^ErUB/)
  })

  test("GLM thinking blocks have different signature format (not ErUB)", () => {
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
  test("thinking blocks with INVALID signatures are converted to wrapped text", () => {
    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "User is greeting me, I should respond warmly.",
            signature: "glm_invalid_signature_12345", // Invalid - not starting with ErUB
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

    // Thinking block should be converted
    const thinkingPart = (assistantMsg?.content as any[])?.find((p: any) => p.type === "thinking")
    expect(thinkingPart).toBeUndefined()

    // Should be wrapped in <assistant_thinking> tags
    const convertedText = (assistantMsg?.content as any[])?.find(
      (p: any) => p.type === "text" && p.text.includes("<assistant_thinking>"),
    )
    expect(convertedText).toBeDefined()
    expect(convertedText.text).toContain("User is greeting me")
  })

  test("thinking blocks with VALID Claude signatures are preserved", () => {
    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "Let me think about this...",
            signature: "ErUBCkYIAxgCIkDK8Y0dcPmz8BQ4K7W9vN...", // Valid Claude signature
          },
          { type: "text", text: "Hello! How can I help you today?" },
        ],
      },
    ] as any[]

    const claudeOptions = { thinking: { type: "enabled", budgetTokens: 16000 } }
    const transformed = ProviderTransform.message(messages, claudeModel, claudeOptions)

    const assistantMsg = transformed.find((m) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()

    // Valid thinking block should be preserved
    const thinkingPart = (assistantMsg?.content as any[])?.find((p: any) => p.type === "thinking")
    expect(thinkingPart).toBeDefined()
    expect(thinkingPart.signature).toMatch(/^ErUB/)
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

  test("reasoning blocks are converted to wrapped text with distinct tags", () => {
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

    // Reasoning part should be converted
    const reasoningPart = (assistantMsg?.content as any[])?.find((p: any) => p.type === "reasoning")
    expect(reasoningPart).toBeUndefined()

    // Should use <assistant_reasoning> tags (distinct from thinking)
    const convertedText = (assistantMsg?.content as any[])?.find(
      (p: any) => p.type === "text" && p.text.includes("<assistant_reasoning>"),
    )
    expect(convertedText).toBeDefined()
    expect(convertedText.text).toContain("Let me calculate")
  })

  test("empty thinking blocks are filtered out", () => {
    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "", // Empty thinking
            signature: "glm_sig",
          },
          { type: "text", text: "Hi there!" },
        ],
      },
    ] as any[]

    const transformed = ProviderTransform.message(messages, claudeModel, {})

    const assistantMsg = transformed.find((m) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()

    // Should only have the text part, no empty thinking wrapper
    const content = assistantMsg?.content as any[]
    expect(content.length).toBe(1)
    expect(content[0].text).toBe("Hi there!")
  })

  test("messages with only empty thinking are filtered out entirely", () => {
    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "",
            signature: "glm_sig",
          },
        ],
      },
      { role: "user", content: "World" },
    ] as any[]

    const transformed = ProviderTransform.message(messages, claudeModel, {})

    // Assistant message with only empty thinking should be removed
    const assistantMsgs = transformed.filter((m) => m.role === "assistant")
    expect(assistantMsgs.length).toBe(0)
  })

  test("multiple thinking blocks in single message are all converted", () => {
    const messages = [
      { role: "user", content: "Complex question" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "First thought...",
            signature: "glm_sig_1",
          },
          {
            type: "thinking",
            thinking: "Second thought...",
            signature: "glm_sig_2",
          },
          { type: "text", text: "Here's my answer." },
        ],
      },
    ] as any[]

    const transformed = ProviderTransform.message(messages, claudeModel, {})

    const assistantMsg = transformed.find((m) => m.role === "assistant")
    const content = assistantMsg?.content as any[]

    // No thinking blocks should remain
    const thinkingParts = content.filter((p: any) => p.type === "thinking")
    expect(thinkingParts.length).toBe(0)

    // Both should be converted to wrapped text
    const wrappedParts = content.filter(
      (p: any) => p.type === "text" && p.text.includes("<assistant_thinking>"),
    )
    expect(wrappedParts.length).toBe(2)
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

    // Tool call and result should both exist
    const assistantWithTool = transformed.find(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p: any) => p.type === "tool-call"),
    )
    const toolResult = transformed.find(
      (m) => m.role === "tool" && Array.isArray(m.content) && m.content.some((p: any) => p.type === "tool-result"),
    )

    expect(assistantWithTool).toBeDefined()
    expect(toolResult).toBeDefined()

    // Tool IDs should match (normalized)
    const toolCall = (assistantWithTool!.content as any[]).find((p: any) => p.type === "tool-call")
    const toolResultPart = (toolResult!.content as any[]).find((p: any) => p.type === "tool-result")
    expect(toolCall.toolCallId).toBe(toolResultPart.toolCallId)

    // Thinking should be converted
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

    // Assistant with tool call should NOT be removed
    const assistantMsg = transformed.find((m) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()
  })
})

describe("Tool Call ID Normalization", () => {
  test("tool call IDs are normalized for Claude compatibility", () => {
    const messages = [
      { role: "user", content: "Do something" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call:abc@123#def", // Special characters
            toolName: "test",
            args: {},
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call:abc@123#def",
            result: "done",
          },
        ],
      },
    ] as any[]

    const transformed = ProviderTransform.message(messages, claudeModel, {})

    const assistantMsg = transformed.find((m) => m.role === "assistant")
    const toolMsg = transformed.find((m) => m.role === "tool")

    const toolCall = (assistantMsg?.content as any[])[0]
    const toolResult = (toolMsg?.content as any[])[0]

    // Both should be normalized to same value
    expect(toolCall.toolCallId).toBe(toolResult.toolCallId)
    // Should only contain allowed characters
    expect(toolCall.toolCallId).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})
