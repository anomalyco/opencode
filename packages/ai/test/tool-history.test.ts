import { describe, expect, test } from "bun:test"
import { Message, ToolCallPart, ToolResultPart } from "../src/schema/messages.js"
import { normalizeToolHistory } from "../src/tool-history.js"

const toolCall = (id: string, name = id) => ToolCallPart.make({ id, name, input: {} })
const toolResult = (id: string, value: unknown, name = id, resultType?: "text" | "content" | "error") =>
  Message.tool(ToolResultPart.make({ id, name, result: value, resultType }))

describe("tool history normalization", () => {
  test("fills missing local results before the next step", () => {
    const normalized = normalizeToolHistory([
      Message.assistant([toolCall("first"), toolCall("second")]),
      toolResult("first", "done", "wrong", "text"),
      Message.user("Continue."),
      Message.assistant(toolCall("trailing")),
    ])

    expect(normalized.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
      "tool",
      "user",
      "assistant",
    ])
    expect(normalized[1]?.content[0]).toMatchObject({ type: "tool-result", id: "first", name: "first" })
    expect(normalized[2]?.content).toEqual([
      { type: "tool-result", id: "second", name: "second", result: { type: "error", value: "Tool result missing" } },
    ])
    expect(normalized[4]?.content).toEqual([toolCall("trailing")])
  })

  test("normalizes empty results without changing whitespace or media", () => {
    const media = { type: "file" as const, uri: "data:image/png;base64,AQID", mime: "image/png" }
    const normalized = normalizeToolHistory([
      Message.assistant([
        toolCall("text"),
        toolCall("content"),
        toolCall("error"),
        toolCall("mixed"),
        toolCall("whitespace"),
      ]),
      toolResult("text", "", "text", "text"),
      toolResult("content", [], "content", "content"),
      toolResult("error", "", "error", "error"),
      toolResult("mixed", [{ type: "text", text: "" }, media], "mixed", "content"),
      toolResult("whitespace", "   ", "whitespace", "text"),
    ])

    expect(normalized.slice(1).map((message) => message.content[0])).toEqual([
      { type: "tool-result", id: "text", name: "text", result: { type: "text", value: "(no tool output)" } },
      { type: "tool-result", id: "content", name: "content", result: { type: "text", value: "(no tool output)" } },
      { type: "tool-result", id: "error", name: "error", result: { type: "error", value: "(no tool output)" } },
      { type: "tool-result", id: "mixed", name: "mixed", result: { type: "content", value: [media] } },
      { type: "tool-result", id: "whitespace", name: "whitespace", result: { type: "text", value: "   " } },
    ])
  })

  test("leaves unmatched and provider-executed history unchanged", () => {
    const hostedCall = ToolCallPart.make({
      id: "hosted",
      name: "web_search",
      input: {},
      providerExecuted: true,
    })
    const hostedResult = ToolResultPart.make({
      id: "hosted",
      name: "web_search",
      result: "",
      resultType: "text",
      providerExecuted: true,
    })
    const hosted = Message.assistant([hostedCall, hostedResult])
    const orphan = toolResult("orphan", "ignored", "orphan", "text")

    expect(normalizeToolHistory([orphan, hosted])).toEqual([orphan, hosted])
  })
})
