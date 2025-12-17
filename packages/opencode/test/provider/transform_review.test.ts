import { describe, it, expect } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import type { ModelMessage } from "ai"

describe("ProviderTransform.normalizeMessages (Interleaving)", () => {
  const model: any = {
    api: { id: "claude-3-5-sonnet" },
    providerID: "anthropic",
  }

  it("should interleave simple tool calls and results", () => {
    const input: any[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Thinking..." },
          { type: "tool-call", toolCallId: "call_1", toolName: "tool1", args: {} },
          { type: "tool-call", toolCallId: "call_2", toolName: "tool2", args: {} },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call_1", result: "result1" },
          { type: "tool-result", toolCallId: "call_2", result: "result2" },
        ],
      },
    ]

    const output = ProviderTransform.message(input as ModelMessage[], model)

    expect(output).toHaveLength(2)
    expect(output[0].role).toBe("assistant")
    expect(output[1].role).toBe("tool")

    const assistantParts = output[0].content as any[]
    const firstToolCallIndex = assistantParts.findIndex((p) => p.type === "tool-call")
    expect(firstToolCallIndex).toBeGreaterThanOrEqual(0)
    expect(assistantParts.slice(firstToolCallIndex).every((p) => p.type === "tool-call")).toBe(true)

    const toolCalls = assistantParts.filter((p) => p.type === "tool-call")
    expect(toolCalls.map((p) => p.toolCallId)).toEqual(["call_1", "call_2"])

    const toolResults = output[1].content as any[]
    expect(toolResults.map((p) => p.type)).toEqual(["tool-result", "tool-result"])
    expect(toolResults.map((p) => p.toolCallId)).toEqual(["call_1", "call_2"])
  })

  it("should handle missing results by bailing out", () => {
    const input: any[] = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "tool1", args: {} }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "wrong_id", result: "result1" }],
      },
    ]

    const output = ProviderTransform.message(input as ModelMessage[], model)
    expect(output).toHaveLength(2)
    expect(output[0].role).toBe("assistant")
    expect(output[1].role).toBe("tool")
    expect((output[0].content as any)[0].toolCallId).toBe("call_1")
  })

  it("should move synthetic attachment messages", () => {
    const input: any[] = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "tool1", args: {} }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Tool tool1 returned an attachment" }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call_1", result: "result1" }],
      },
    ]

    const output = ProviderTransform.message(input as ModelMessage[], model)

    expect(output).toHaveLength(3)
    expect(output[0].role).toBe("assistant")
    expect(output[1].role).toBe("tool")
    expect(output[2].role).toBe("user")
    expect((output[0].content as any)[0].toolCallId).toBe("call_1")
    expect((output[1].content as any)[0].toolCallId).toBe("call_1")
    expect((output[2].content as any)[0].text).toContain("returned an attachment")
  })
})
