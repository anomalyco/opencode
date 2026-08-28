import { describe, expect, test } from "bun:test"
import { LLMEvent, LLMResponse } from "../src"

const reduce = (events: ReadonlyArray<LLMEvent>) => events.reduce(LLMResponse.reduce, LLMResponse.empty())
const finishEvents = (events: ReadonlyArray<LLMEvent>) => events.filter(LLMEvent.is.finish)

describe("LLMResponse reducer", () => {
  test("assembles interleaved reasoning and text with end metadata", () => {
    const events = [
      LLMEvent.reasoningStart({ id: "r1" }),
      LLMEvent.reasoningDelta({ id: "r1", text: "I should " }),
      LLMEvent.textStart({ id: "t1" }),
      LLMEvent.reasoningDelta({ id: "r1", text: "compare..." }),
      LLMEvent.reasoningEnd({ id: "r1", providerMetadata: { anthropic: { signature: "sig" } } }),
      LLMEvent.textDelta({ id: "t1", text: "Answer" }),
      LLMEvent.textEnd({ id: "t1" }),
      LLMEvent.finish({ reason: "stop", usage: { outputTokens: 5 } }),
    ]
    const response = LLMResponse.fromEvents(events)

    expect(response?.finishReason).toBe("stop")
    expect(response?.usage).toMatchObject({ outputTokens: 5 })
    expect(response?.events).toEqual(events)
    expect(response?.events.map((event) => event.type)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "text-start",
      "reasoning-delta",
      "reasoning-end",
      "text-delta",
      "text-end",
      "finish",
    ])
    expect(finishEvents(response?.events ?? [])).toHaveLength(1)
    expect(response?.message.content).toEqual([
      {
        type: "reasoning",
        text: "I should compare...",
        providerMetadata: { anthropic: { signature: "sig" } },
      },
      { type: "text", text: "Answer" },
    ])
  })

  test("preserves partial content without completing a failed stream", () => {
    const state = reduce([LLMEvent.textStart({ id: "t1" }), LLMEvent.textDelta({ id: "t1", text: "partial" })])

    expect(LLMResponse.complete(state)).toBeUndefined()
    expect(state.message.content).toEqual([{ type: "text", text: "partial" }])
  })

  test("does not complete ended content without a terminal finish", () => {
    const state = reduce([
      LLMEvent.textStart({ id: "t1" }),
      LLMEvent.textDelta({ id: "t1", text: "partial" }),
      LLMEvent.textEnd({ id: "t1" }),
    ])

    expect(LLMResponse.complete(state)).toBeUndefined()
    expect(state.message.content).toEqual([{ type: "text", text: "partial" }])
  })

  test("uses terminal usage when present and keeps prior usage when finish omits it", () => {
    const withFinishUsage = LLMResponse.fromEvents([
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 3 } }),
      LLMEvent.finish({ reason: "stop", usage: { outputTokens: 2 } }),
    ])
    const withoutFinishUsage = LLMResponse.fromEvents([
      LLMEvent.stepFinish({ index: 0, reason: "stop", usage: { inputTokens: 3 } }),
      LLMEvent.finish({ reason: "stop" }),
    ])

    expect(withFinishUsage?.usage).toMatchObject({ outputTokens: 2 })
    expect(withoutFinishUsage?.usage).toMatchObject({ inputTokens: 3 })
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
