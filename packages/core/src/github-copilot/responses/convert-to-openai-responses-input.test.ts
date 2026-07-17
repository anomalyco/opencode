import { describe, expect, it } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { convertToOpenAIResponsesInput } from "./convert-to-openai-responses-input"

const options = { systemMessageMode: "system", store: false } as const

describe("convertToOpenAIResponsesInput orphaned tool results", () => {
  it("drops a tool result whose tool call was removed upstream", async () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
      // Assistant turn carrying the matching tool-call was dropped upstream,
      // leaving only the orphaned result below.
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_2",
            toolName: "lookup",
            output: { type: "json", value: { forecast: "sunny" } },
          },
        ],
      },
    ]

    const { input, warnings } = await convertToOpenAIResponsesInput({ prompt, ...options })

    expect(input.some((item) => "call_id" in item && item.call_id === "call_2")).toBe(false)
    expect(input).toEqual([{ role: "user", content: [{ type: "input_text", text: "What is the weather?" }] }])
    expect(warnings.some((w) => w.type === "other" && w.message.includes("orphaned tool result"))).toBe(true)
  })

  it("keeps matched results and drops only the orphaned one", async () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_1", toolName: "lookup", input: { query: "weather" } }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "lookup",
            output: { type: "json", value: { forecast: "sunny" } },
          },
          {
            type: "tool-result",
            toolCallId: "call_2",
            toolName: "lookup",
            output: { type: "json", value: { forecast: "rain" } },
          },
        ],
      },
    ]

    const { input, warnings } = await convertToOpenAIResponsesInput({ prompt, ...options })

    const outputs = input.filter((item) => "type" in item && item.type === "function_call_output")
    expect(outputs).toEqual([{ type: "function_call_output", call_id: "call_1", output: '{"forecast":"sunny"}' }])
    expect(input.some((item) => "type" in item && item.type === "function_call" && item.call_id === "call_1")).toBe(
      true,
    )
    expect(warnings.some((w) => w.type === "other" && w.message.includes("call_2"))).toBe(true)
  })
})
