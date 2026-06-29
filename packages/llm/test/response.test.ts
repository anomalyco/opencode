import { describe, expect, test } from "bun:test"
import { LLMEvent, LLMResponse } from "../src"

const reduce = (events: ReadonlyArray<LLMEvent>) => events.reduce(LLMResponse.reduce, LLMResponse.empty())

describe("LLMResponse reducer", () => {
  test("assembles interleaved reasoning and text with end metadata", () => {
    const response = LLMResponse.fromEvents([
      LLMEvent.reasoningStart({ id: "r1" }),
      LLMEvent.reasoningDelta({ id: "r1", text: "I should " }),
      LLMEvent.textStart({ id: "t1" }),
      LLMEvent.reasoningDelta({ id: "r1", text: "compare..." }),
      LLMEvent.reasoningEnd({ id: "r1", providerMetadata: { anthropic: { signature: "sig" } } }),
      LLMEvent.textDelta({ id: "t1", text: "Answer" }),
      LLMEvent.textEnd({ id: "t1" }),
      LLMEvent.finish({ reason: "stop", usage: { outputTokens: 5 } }),
    ])

    expect(response?.finishReason).toBe("stop")
    expect(response?.usage).toMatchObject({ outputTokens: 5 })
    expect(response?.message.content).toEqual([
      {
        type: "reasoning",
        text: "I should compare...",
        providerMetadata: { anthropic: { signature: "sig" } },
      },
      { type: "text", text: "Answer" },
    ])
    expect(response?.events).toHaveLength(8)
  })

  test("preserves partial content without completing a failed stream", () => {
    const state = reduce([LLMEvent.textStart({ id: "t1" }), LLMEvent.textDelta({ id: "t1", text: "partial" })])

    expect(LLMResponse.complete(state)).toBeUndefined()
    expect(state.message.content).toEqual([{ type: "text", text: "partial" }])
  })

  test("assembles tool-call content only after the completed tool call event", () => {
    const pending = reduce([
      LLMEvent.toolInputStart({ id: "call_1", name: "lookup" }),
      LLMEvent.toolInputDelta({ id: "call_1", name: "lookup", text: '{"query"' }),
    ])

    expect(pending.message.content).toEqual([])
    expect(pending.toolInputs.call_1?.text).toBe('{"query"')

    const response = LLMResponse.fromEvents([
      ...pending.events,
      LLMEvent.toolInputDelta({ id: "call_1", name: "lookup", text: ':"weather"}' }),
      LLMEvent.toolInputEnd({ id: "call_1", name: "lookup" }),
      LLMEvent.toolCall({ id: "call_1", name: "lookup", input: { query: "weather" } }),
      LLMEvent.finish({ reason: "tool-calls" }),
    ])

    expect(response?.message.content).toEqual([
      { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
    ])
  })
})
