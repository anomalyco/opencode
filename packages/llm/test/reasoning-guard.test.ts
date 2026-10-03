import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "../src/schema"
import {
  createReasoningGuard,
  guardReasoningStream,
  isDegenerateReasoning,
  splitReasoningSegments,
} from "../src/reasoning-guard"
import { it } from "./lib/effect"

const reasoningEvents = (texts: ReadonlyArray<string>, id = "reasoning-0"): LLMEvent[] => [
  LLMEvent.reasoningStart({ id }),
  ...texts.map((text) => LLMEvent.reasoningDelta({ id, text })),
]

const collect = (events: ReadonlyArray<LLMEvent>) =>
  Effect.runPromise(guardReasoningStream(Stream.fromIterable(events)).pipe(Stream.runCollect)).then((chunk) =>
    Array.from(chunk),
  )

describe("reasoning loop detector", () => {
  test("splits sentence-terminated phrases without newlines", () => {
    expect(splitReasoningSegments("好。好。好。")).toEqual(["好。", "好。", "好。"])
  })

  test("flags dozens of near-empty repeated lines with occasional variants", () => {
    const lines: string[] = []
    for (let i = 0; i < 40; i++) {
      if (i % 8 === 3) lines.push("我输出。")
      else if (i % 11 === 5) lines.push("(写)")
      else if (i % 13 === 7) lines.push("(执行)")
      else if (i % 9 === 4) lines.push("嗯。")
      else lines.push("好。")
    }
    expect(isDegenerateReasoning(lines.join("\n"))).toBe(true)
  })

  test("flags consecutive repetition beyond the threshold and ignores short bursts", () => {
    expect(isDegenerateReasoning(Array(12).fill("好。").join("\n"))).toBe(true)
    expect(isDegenerateReasoning(Array(11).fill("好。").join("\n"))).toBe(false)
  })

  test("passes coherent diverse reasoning", () => {
    const text = [
      "First I need to understand the request.",
      "The user wants a streaming guard for reasoning loops.",
      "I will check the provider pipeline and add detection.",
      "Then I should write regression tests with bun test.",
      "Finally I verify the affected package still passes.",
      "Edge cases include compaction and long sessions.",
      "The fix must truncate cleanly instead of hanging.",
      "Let me review the lifecycle helpers once more.",
    ].join("\n")
    expect(isDegenerateReasoning(text)).toBe(false)
    expect(isDegenerateReasoning("short reasoning")).toBe(false)
    expect(isDegenerateReasoning("")).toBe(false)
  })

  test("flags balanced two-phrase alternation via cycle detection", () => {
    const alternating = Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? "嗯。" : "好。")).join("\n")
    expect(isDegenerateReasoning(alternating)).toBe(true)
  })

  test("flags char-level repetition without boundaries", () => {
    expect(isDegenerateReasoning("abc".repeat(60))).toBe(true)
    expect(isDegenerateReasoning("好。".repeat(80))).toBe(true)
  })

  test("stateful guard trips once the loop forms", () => {
    const guard = createReasoningGuard()
    for (let i = 0; i < 11; i++) expect(guard.push("好。\n").degenerate).toBe(false)
    expect(guard.push("好。\n").degenerate).toBe(true)
  })
})

describe("reasoning stream guard", () => {
  it.effect("truncates the looping tail but lets productive text through", () =>
    Effect.gen(function* () {
      const loop = Array(12).fill("好。\n")
      const events = yield* guardReasoningStream(Stream.fromIterable(reasoningEvents(loop))).pipe(Stream.runCollect)
      const list = Array.from(events)
      const deltas = list.filter(LLMEvent.is.reasoningDelta)
      // Triggering delta is dropped and open reasoning is concluded.
      expect(deltas.length).toBeLessThan(loop.length)
      expect(list.filter(LLMEvent.is.reasoningEnd).length).toBe(1)
      expect(list.find(LLMEvent.is.providerError)).toBeUndefined()
    }),
  )

  it.effect("suppresses further reasoning after degeneration while passing text", () =>
    Effect.gen(function* () {
      const loop = Array(12).fill("好。\n")
      const input: LLMEvent[] = [
        ...reasoningEvents(loop),
        LLMEvent.reasoningDelta({ id: "reasoning-0", text: "好。\n" }),
        LLMEvent.textStart({ id: "text-0" }),
        LLMEvent.textDelta({ id: "text-0", text: "recovered" }),
        LLMEvent.finish({ reason: "stop" }),
      ]
      const events = yield* guardReasoningStream(Stream.fromIterable(input)).pipe(Stream.runCollect)
      const list = Array.from(events)
      expect(list.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["recovered"])
      expect(list.filter(LLMEvent.is.finish).length).toBe(1)
      // Only the pre-degeneration deltas survive; post-degeneration reasoning is dropped.
      expect(list.filter(LLMEvent.is.reasoningDelta).length).toBeLessThan(loop.length)
    }),
  )

  it.effect("terminates a prolonged loop with a provider error instead of hanging", () =>
    Effect.gen(function* () {
      const loop = Array(300).fill("好。\n")
      const events = yield* guardReasoningStream(Stream.fromIterable(reasoningEvents(loop))).pipe(Stream.runCollect)
      const list = Array.from(events)
      const error = list.find(LLMEvent.is.providerError)
      expect(error?.message.startsWith("Degenerate repetitive reasoning stream detected")).toBe(true)
      // takeUntil ends the stream at the synthetic error: no unbounded tail.
      expect(list.at(-1)?.type).toBe("provider-error")
    }),
  )

  it.effect("passes healthy streams untouched", () =>
    Effect.gen(function* () {
      const input: LLMEvent[] = [
        LLMEvent.reasoningStart({ id: "reasoning-0" }),
        LLMEvent.reasoningDelta({ id: "reasoning-0", text: "Thinking step one.\n" }),
        LLMEvent.reasoningDelta({ id: "reasoning-0", text: "Thinking step two.\n" }),
        LLMEvent.reasoningEnd({ id: "reasoning-0" }),
        LLMEvent.finish({ reason: "stop" }),
      ]
      const events = yield* guardReasoningStream(Stream.fromIterable(input)).pipe(Stream.runCollect)
      expect(Array.from(events)).toEqual(input)
    }),
  )

  test("collect helper covers the issue shape end to end", async () => {
    const lines: string[] = []
    for (let i = 0; i < 40; i++) {
      if (i % 8 === 3) lines.push("我输出。\n")
      else if (i % 11 === 5) lines.push("(写)\n")
      else if (i % 13 === 7) lines.push("(执行)\n")
      else if (i % 9 === 4) lines.push("嗯。\n")
      else lines.push("好。\n")
    }
    const list = await collect(reasoningEvents(lines))
    // Degeneration is caught mid-stream: output stays bounded.
    expect(list.filter(LLMEvent.is.reasoningDelta).length).toBeLessThan(lines.length)
    expect(list.some((event) => event.type === "reasoning-end")).toBe(true)
  })
})
