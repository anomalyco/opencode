import { describe, expect, test } from "bun:test"
import { LanguageModel, LLMEvent, LLMResponse, Message, Usage } from "../src/effect.js"
import { addUsage, nextRequest, pendingCalls } from "../src/loop.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { LLM } from "../src/llm.js"

const model = LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route })

const step = (...events: ReadonlyArray<LLMEvent>) =>
  LLMResponse.fromEvents([...events, LLMEvent.finish({ reason: { normalized: "tool-calls" } })])!
const cutOff = (...events: ReadonlyArray<LLMEvent>) =>
  LLMResponse.fromEvents([...events, LLMEvent.finish({ reason: { normalized: "length" } })])!

const read = LLMEvent.toolCall({ id: "call-1", name: "read_file", input: { path: "a.txt" } })
const hosted = LLMEvent.toolCall({ id: "call-2", name: "web_search", input: {}, providerExecuted: true })
const invalid = LLMEvent.toolInputError({ id: "call-4", name: "read_file", raw: '{"path": "a' })
const answer = LLMEvent.toolCall({ id: "call-3", name: "generate_object", input: { text: "hi" } })

describe("pendingCalls", () => {
  test("returns client calls and skips provider-executed ones", () => {
    expect(pendingCalls(step(read, hosted)).map((item) => item.call.id)).toEqual(["call-1"])
  })

  test("answers input that is not valid JSON with an error and an empty replayed call", () => {
    expect(pendingCalls(step(invalid))).toEqual([
      {
        call: expect.objectContaining({ type: "tool-call", id: "call-4", name: "read_file", input: {} }),
        error: 'Invalid tool arguments: the input is not valid JSON. Received: {"path": "a',
      },
    ])
  })

  test("returns nothing when the step hit the output token limit", () => {
    expect(pendingCalls(cutOff(read, invalid))).toEqual([])
  })

  test("returns nothing once the answer tool is called", () => {
    expect(pendingCalls(step(read, answer), "generate_object")).toEqual([])
    expect(pendingCalls(step(read, answer)).map((item) => item.call.id)).toEqual(["call-1", "call-3"])
  })
})

describe("nextRequest", () => {
  test("appends the assistant message and one tool message per call", () => {
    const request = LLM.request({ model, prompt: "Read the file." })
    const response = step(read)
    const results = [{ result: { type: "text", value: "hello" } as const, events: [] }]
    const next = nextRequest(request, response, [{ call: read }], results, false)

    expect(next.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
    expect(next.messages[1]).toBe(response.message)
    expect(next.messages[2]).toEqual(
      Message.tool({ id: "call-1", name: "read_file", result: { type: "text", value: "hello" } }),
    )
  })

  test("resets a forced toolChoice unless it is kept, and adds the replayed call for invalid input", () => {
    const request = LLM.request({ model, prompt: "Read the file.", toolChoice: "required" })
    const response = step(invalid)
    const calls = pendingCalls(response)
    const results = [{ result: { type: "error", value: "bad" } as const, events: [] }]

    expect(nextRequest(request, response, calls, results, false).toolChoice?.type).toBe("auto")
    expect(nextRequest(request, response, calls, results, true).toolChoice?.type).toBe("required")
    expect(nextRequest(request, response, calls, results, false).messages[1].content).toEqual([calls[0].call])
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
