import { describe, expect, test } from "bun:test"
import { LanguageModel, LLMEvent, LLMResponse, Message, Usage } from "../src/effect.js"
import { addUsage, nextRequest, pendingCalls } from "../src/loop.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { LLM } from "../src/llm.js"

const model = LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route })

const step = (...events: ReadonlyArray<LLMEvent>) =>
  LLMResponse.fromEvents([...events, LLMEvent.finish({ reason: { normalized: "tool-calls" } })])!

const read = LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } })
const hosted = LLMEvent.toolCall({ id: "call-2", name: "web_search", input: {}, providerExecuted: true })
const answer = LLMEvent.toolCall({ id: "call-3", name: "generate_object", input: { text: "hi" } })

describe("pendingCalls", () => {
  test("returns client calls and skips provider-executed ones", () => {
    expect(pendingCalls(step(read, hosted)).map((call) => call.id)).toEqual(["call-1"])
  })

  test("returns nothing once the answer tool is called", () => {
    expect(pendingCalls(step(read, answer), "generate_object")).toEqual([])
    expect(pendingCalls(step(read, answer)).map((call) => call.id)).toEqual(["call-1", "call-3"])
  })
})

describe("nextRequest", () => {
  test("appends the assistant message and one tool message per call", () => {
    const request = LLM.request({ model, prompt: "Read the file." })
    const response = step(read)
    const results = [{ result: { type: "text", value: "hello" } as const, events: [] }]
    const next = nextRequest(request, response, [read], results)

    expect(next.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
    expect(next.messages[1]).toBe(response.message)
    expect(next.messages[2]).toEqual(
      Message.tool({ id: "call-1", name: "read_file", result: { type: "text", value: "hello" } }),
    )
  })
})

describe("addUsage", () => {
  test("sums counts and keeps the latest context size", () => {
    const total = addUsage(
      new Usage({ inputTokens: 10, outputTokens: 2, contextTokens: 12 }),
      new Usage({ inputTokens: 20, contextTokens: 34 }),
    )
    expect(total).toEqual(new Usage({ inputTokens: 30, outputTokens: 2, contextTokens: 34 }))
  })
})
