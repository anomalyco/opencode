import { describe, expect, test } from "bun:test"
import { LLMEvent, LLMResponse, Media } from "../src/index.js"

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
      LLMEvent.finish({ reason: { normalized: "stop" }, usage: { outputTokens: 5 } }),
    ]
    const response = LLMResponse.fromEvents(events)

    expect(response?.finishReason).toEqual({ normalized: "stop" })
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
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" }, usage: { inputTokens: 3 } }),
      LLMEvent.finish({ reason: { normalized: "stop" }, usage: { outputTokens: 2 } }),
    ])
    const withoutFinishUsage = LLMResponse.fromEvents([
      LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" }, usage: { inputTokens: 3 } }),
      LLMEvent.finish({ reason: { normalized: "stop" } }),
    ])

    expect(withFinishUsage?.usage).toMatchObject({ outputTokens: 2 })
    expect(withoutFinishUsage?.usage).toMatchObject({ inputTokens: 3 })
  })

  test("preserves the raw finish reason", () => {
    const response = LLMResponse.fromEvents([
      LLMEvent.finish({ reason: { normalized: "unknown", raw: "provider_limit" } }),
    ])

    expect(response?.finishReason).toEqual({ normalized: "unknown", raw: "provider_limit" })
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
      LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
    ])

    expect(response?.message.content).toEqual([
      { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" } },
    ])
  })

  test("authoritative text-end value replaces accumulated deltas", () => {
    const response = LLMResponse.fromEvents([
      LLMEvent.textStart({ id: "t1" }),
      LLMEvent.textDelta({ id: "t1", text: "Hel" }),
      LLMEvent.textEnd({ id: "t1", text: "Hello!" }),
      LLMEvent.finish({ reason: { normalized: "stop" } }),
    ])

    expect(response?.message.content).toEqual([{ type: "text", text: "Hello!" }])
    expect(response?.text).toBe("Hello!")
  })

  test("text-end without value keeps joined deltas", () => {
    const response = LLMResponse.fromEvents([
      LLMEvent.textStart({ id: "t1" }),
      LLMEvent.textDelta({ id: "t1", text: "Hel" }),
      LLMEvent.textDelta({ id: "t1", text: "lo" }),
      LLMEvent.textEnd({ id: "t1" }),
      LLMEvent.finish({ reason: { normalized: "stop" } }),
    ])

    expect(response?.message.content).toEqual([{ type: "text", text: "Hello" }])
    expect(response?.text).toBe("Hello")
  })

  test("authoritative reasoning-end value replaces only its own fragment", () => {
    const response = LLMResponse.fromEvents([
      LLMEvent.reasoningStart({ id: "r1:0" }),
      LLMEvent.reasoningDelta({ id: "r1:0", text: "First summ" }),
      LLMEvent.reasoningEnd({ id: "r1:0", text: "First summary." }),
      LLMEvent.reasoningStart({ id: "r1:1" }),
      LLMEvent.reasoningDelta({ id: "r1:1", text: "Second summary." }),
      LLMEvent.reasoningEnd({ id: "r1:1" }),
      LLMEvent.finish({ reason: { normalized: "stop" } }),
    ])

    expect(response?.message.content).toEqual([
      { type: "reasoning", text: "First summary." },
      { type: "reasoning", text: "Second summary." },
    ])
    expect(response?.reasoning).toBe("First summary.Second summary.")
  })

  test("end value recovers a fragment that streamed no deltas", () => {
    const response = LLMResponse.fromEvents([
      LLMEvent.textStart({ id: "t1" }),
      LLMEvent.textEnd({ id: "t1", text: "Hello!" }),
      LLMEvent.finish({ reason: { normalized: "stop" } }),
    ])

    expect(response?.message.content).toEqual([{ type: "text", text: "Hello!" }])
    expect(response?.text).toBe("Hello!")
  })

  test("clears malformed tool input without appending an executable call", () => {
    const state = reduce([
      LLMEvent.toolInputStart({ id: "call_1", name: "lookup" }),
      LLMEvent.toolInputDelta({ id: "call_1", name: "lookup", text: '{"query":"partial' }),
      LLMEvent.toolInputError({
        id: "call_1",
        name: "lookup",
        raw: '{"query":"partial',
      }),
    ])

    expect(state.toolInputs).toEqual({})
    expect(state.message.content).toEqual([])
  })
})

describe("LLMResponse.fromEvents", () => {
  const folded = (events: ReadonlyArray<LLMEvent>) => LLMResponse.complete(reduce(events))
  const expectEquivalent = (events: ReadonlyArray<LLMEvent>) => {
    const expected = folded(events)
    const actual = LLMResponse.fromEvents(events)
    expect(actual).toEqual(expected)
    if (!actual || !expected) return
    expect(actual).toBeInstanceOf(LLMResponse)
    expect(actual.message.content).toStrictEqual(expected.message.content)
    expect(actual.events).toStrictEqual(expected.events)
    expect(actual.events).not.toBe(events)
    expect(actual.usage).toStrictEqual(expected.usage)
    expect(actual.finishReason).toStrictEqual(expected.finishReason)
  }

  const stop = LLMEvent.finish({ reason: { normalized: "stop" } })
  const metadata = (value: string) => ({ test: { value } })

  test("matches the public fold for edge-case sequences", () => {
    const cases: ReadonlyArray<ReadonlyArray<LLMEvent>> = [
      [],
      [stop],
      [LLMEvent.textStart({ id: "t1" }), LLMEvent.textDelta({ id: "t1", text: "unfinished" })],
      [LLMEvent.providerError({ message: "boom" })],
      [LLMEvent.textDelta({ id: "t1", text: "partial" }), LLMEvent.providerError({ message: "boom" })],
      [
        LLMEvent.finish({ reason: { normalized: "length" } }),
        LLMEvent.providerError({ message: "late" }),
        LLMEvent.textDelta({ id: "t1", text: "after finish" }),
        LLMEvent.finish({ reason: { normalized: "stop" }, usage: { outputTokens: 9 } }),
      ],
      [
        LLMEvent.textStart({ id: "t1", providerMetadata: metadata("start") }),
        LLMEvent.textDelta({ id: "t1", text: "a" }),
        LLMEvent.textDelta({ id: "t1", text: "b", providerMetadata: metadata("delta") }),
        LLMEvent.textEnd({ id: "t1" }),
        LLMEvent.textEnd({ id: "t1", text: "replaced", providerMetadata: metadata("end") }),
        LLMEvent.textDelta({ id: "t1", text: "-more" }),
        stop,
      ],
      [
        LLMEvent.textEnd({ id: "missing", text: "ignored" }),
        LLMEvent.reasoningEnd({ id: "missing", text: "ignored" }),
        LLMEvent.reasoningDelta({ id: "r1", text: "implicit", providerMetadata: metadata("r") }),
        LLMEvent.textDelta({ id: "r1", text: "same id, other kind" }),
        LLMEvent.reasoningStart({ id: "r1", providerMetadata: metadata("ignored") }),
        LLMEvent.reasoningEnd({ id: "r1" }),
        stop,
      ],
      [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call_1", name: "lookup" }),
        LLMEvent.toolInputDelta({ id: "call_1", name: "lookup", text: "{}" }),
        LLMEvent.toolInputEnd({ id: "call_1", name: "lookup", providerMetadata: metadata("input") }),
        LLMEvent.toolCall({ id: "call_1", name: "lookup", input: {}, providerMetadata: metadata("call") }),
        LLMEvent.toolInputError({ id: "call_2", name: "lookup", raw: "{" }),
        LLMEvent.toolResult({
          id: "call_1",
          name: "lookup",
          namespace: "ns",
          result: { type: "json", value: { ok: true } },
          providerExecuted: true,
        }),
        LLMEvent.toolError({ id: "call_3", name: "lookup", message: "failed" }),
        LLMEvent.stepFinish({ index: 0, reason: { normalized: "tool-calls" }, usage: { inputTokens: 4 } }),
        LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
      ],
      [
        LLMEvent.compaction({ provider: "openai", encrypted: "opaque" }),
        LLMEvent.media({ media: Media.bytes(Uint8Array.from([1, 2, 3]), "image/png") }),
        LLMEvent.media({
          media: Media.bytes(Uint8Array.from([4]), "image/png"),
          providerMetadata: metadata("media"),
        }),
        LLMEvent.textDelta({ id: "t1", text: "caption" }),
        LLMEvent.providerError({ message: "late" }),
        LLMEvent.finish({ reason: { normalized: "stop" }, usage: { outputTokens: 1 } }),
      ],
    ]
    cases.forEach(expectEquivalent)
  })

  test("matches the public fold for generated interleavings", () => {
    const random = seeded(7)
    const pick = <T>(values: ReadonlyArray<T>) => values[Math.floor(random() * values.length)]!
    const ids = ["a", "b", "c"]
    const maybeMetadata = () => (random() < 0.3 ? metadata(String(Math.floor(random() * 3))) : undefined)
    const maybeText = () => (random() < 0.4 ? `end-${Math.floor(random() * 3)}` : undefined)
    const factories: ReadonlyArray<() => LLMEvent> = [
      () => LLMEvent.textStart({ id: pick(ids), providerMetadata: maybeMetadata() }),
      () => LLMEvent.textDelta({ id: pick(ids), text: pick(["x", "yz", ""]), providerMetadata: maybeMetadata() }),
      () => LLMEvent.textEnd({ id: pick(ids), text: maybeText(), providerMetadata: maybeMetadata() }),
      () => LLMEvent.reasoningStart({ id: pick(ids), providerMetadata: maybeMetadata() }),
      () => LLMEvent.reasoningDelta({ id: pick(ids), text: pick(["r", "st"]), providerMetadata: maybeMetadata() }),
      () => LLMEvent.reasoningEnd({ id: pick(ids), text: maybeText(), providerMetadata: maybeMetadata() }),
      () => LLMEvent.toolInputStart({ id: pick(ids), name: "tool" }),
      () => LLMEvent.toolInputDelta({ id: pick(ids), name: "tool", text: "{" }),
      () => LLMEvent.toolCall({ id: pick(ids), name: "tool", input: { n: 1 }, providerMetadata: maybeMetadata() }),
      () => LLMEvent.toolResult({ id: pick(ids), name: "tool", result: { type: "text", value: "ok" } }),
      () =>
        LLMEvent.stepFinish({
          index: 0,
          reason: { normalized: "stop" },
          usage: random() < 0.5 ? { inputTokens: Math.floor(random() * 10) } : undefined,
        }),
      () =>
        LLMEvent.finish({
          reason: { normalized: pick(["stop", "length", "tool-calls"] as const) },
          usage: random() < 0.5 ? { outputTokens: Math.floor(random() * 10) } : undefined,
        }),
      () => LLMEvent.providerError({ message: "boom" }),
    ]
    Array.from({ length: 300 }, () =>
      Array.from({ length: Math.floor(random() * 40) }, () => pick(factories)()),
    ).forEach(expectEquivalent)
  })
})

function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}
