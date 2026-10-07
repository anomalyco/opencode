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
      "tool",
    ])
    expect(normalized[1]?.content[0]).toMatchObject({ type: "tool-result", id: "first", name: "first" })
    expect(normalized[2]?.content).toEqual([
      { type: "tool-result", id: "second", name: "second", result: { type: "error", value: "Tool result missing" } },
    ])
    expect(normalized[4]?.content).toEqual([toolCall("trailing")])
    expect(normalized[5]?.content).toEqual([
      {
        type: "tool-result",
        id: "trailing",
        name: "trailing",
        result: { type: "error", value: "Tool result missing" },
      },
    ])
  })

  test("fills missing results for trailing calls without replacing available results", () => {
    const calls = Message.assistant([toolCall("answered"), toolCall("unanswered")])
    const answered = toolResult("answered", "done", "answered", "text")
    const hosted = ToolCallPart.make({ id: "hosted", name: "web_search", input: {}, providerExecuted: true })

    expect(normalizeToolHistory([calls, answered])).toEqual([
      calls,
      answered,
      Message.tool(
        ToolResultPart.make({
          id: "unanswered",
          name: "unanswered",
          result: "Tool result missing",
          resultType: "error",
        }),
      ),
    ])
    expect(normalizeToolHistory([Message.assistant(hosted)])).toEqual([Message.assistant(hosted)])
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

  test("uses a matching call as the complete tool identity", () => {
    const normalized = normalizeToolHistory([
      Message.assistant(ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })),
      Message.tool(ToolResultPart.make({ id: "call_1", name: "wrong", namespace: "stale", result: "done" })),
    ])

    expect(normalized[1]?.content[0]).toMatchObject({ name: "lookup", namespace: undefined })
  })

  test("moves system updates after the results of pending calls", () => {
    const calls = Message.assistant([toolCall("first"), toolCall("second")])
    const first = toolResult("first", "one", "first", "text")
    const second = toolResult("second", "two", "second", "text")
    const update = Message.system("First update.")
    const later = Message.system("Second update.")
    const user = Message.user("Continue.")
    const missing = (id: string) =>
      Message.tool(ToolResultPart.make({ id, name: id, result: "Tool result missing", resultType: "error" }))

    expect(normalizeToolHistory([calls, first, update, later, second, user])).toEqual([
      calls,
      first,
      second,
      update,
      later,
      user,
    ])
    expect(normalizeToolHistory([Message.assistant(toolCall("first")), update, user])).toEqual([
      Message.assistant(toolCall("first")),
      missing("first"),
      update,
      user,
    ])
    expect(normalizeToolHistory([Message.assistant(toolCall("first")), update])).toEqual([
      Message.assistant(toolCall("first")),
      missing("first"),
      update,
    ])
  })

  test("moves effort updates after the results of pending calls", () => {
    const call = Message.assistant(toolCall("first"))
    const result = toolResult("first", "one", "first", "text")
    const effort = Message.effort({ effort: "low", previous: "high" })

    expect(normalizeToolHistory([call, effort, result])).toEqual([call, result, effort])
  })

  test("keeps system updates in place when no call is pending", () => {
    const history = [Message.assistant(toolCall("first")), toolResult("first", "one", "first", "text")]
    const update = Message.system("Update.")
    const input = [Message.user("Start."), update, ...history, update, Message.user("Continue.")]

    expect(normalizeToolHistory(input)).toBe(input)
  })
})
