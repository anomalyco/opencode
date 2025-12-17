import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

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
    toolcall: true,
  },
} as any

describe("Anthropic Regression: Tool Interleaving", () => {
  test("moves assistant content after tool calls", () => {
    const toolCallId = "toolu_014QNwQfdnni2HdHSLozPw88"

    const msgs = [
      {
        role: "user",
        content: [{ type: "text", text: "Do the thing" }],
      },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          {
            type: "tool-call",
            toolCallId,
            toolName: "bash",
            args: { command: "ls -la" },
          },
          {
            type: "text",
            text: "I'll summarize after the tool runs.",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: "bash",
            result: "ok",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Next prompt" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs as any, mockClaudeModel) as any[]

    const assistantWithToolCalls = result.findIndex(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((p: any) => p.type === "tool-call"),
    )
    expect(assistantWithToolCalls).toBeGreaterThanOrEqual(0)

    const assistant = result[assistantWithToolCalls]
    const assistantParts = assistant.content as any[]
    const firstToolCallIndex = assistantParts.findIndex((p) => p.type === "tool-call")
    expect(firstToolCallIndex).toBeGreaterThanOrEqual(0)
    expect(assistantParts.slice(firstToolCallIndex).every((p) => p.type === "tool-call")).toBe(true)

    const calls = assistantParts.filter((p) => p.type === "tool-call")
    expect(calls.map((c) => c.toolCallId)).toEqual([toolCallId])

    const toolMsg = result[assistantWithToolCalls + 1]
    expect(toolMsg?.role).toBe("tool")

    const toolResults = toolMsg.content as any[]
    expect(toolResults.map((p) => p.type)).toEqual(["tool-result"])
    expect(toolResults.map((p) => p.toolCallId)).toEqual([toolCallId])

    const after = result[assistantWithToolCalls + 2]
    expect(after?.role).toBe("assistant")
    expect(Array.isArray(after.content)).toBe(true)
    expect(after.content).toEqual([{ type: "text", text: "I'll summarize after the tool runs." }])
  })
})
