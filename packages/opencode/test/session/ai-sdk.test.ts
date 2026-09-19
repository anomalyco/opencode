import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { LLMAISDK } from "@/session/llm/ai-sdk"

type ErrorEvent = Extract<Parameters<typeof LLMAISDK.toLLMEvents>[1], { type: "error" }>

const errorEvent = (error: unknown): ErrorEvent => ({ type: "error", error })

const run = (error: unknown) => Effect.runPromiseExit(LLMAISDK.toLLMEvents(LLMAISDK.adapterState(), errorEvent(error)))

type AnyEvent = Parameters<typeof LLMAISDK.toLLMEvents>[1]

// Feed a whole event sequence through one adapter state, as a real stream would.
const runStream = async (events: AnyEvent[]) => {
  const state = LLMAISDK.adapterState()
  const out: any[] = []
  for (const event of events) {
    const exit = await Effect.runPromiseExit(LLMAISDK.toLLMEvents(state, event))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) out.push(...exit.value)
  }
  return out
}

describe("LLMAISDK.toLLMEvents error handling", () => {
  test("drops orphan reasoning/text stream-state errors without failing the turn", async () => {
    // vercel/ai stream-text.ts enqueues these exact strings as non-fatal in-band
    // error parts when a reasoning/text delta (or its end) has no preceding
    // *-start block. They must not abort the assistant turn.
    for (const message of [
      "reasoning part 0 not found",
      "reasoning part 7 not found",
      "reasoning part rs_abc:0 not found",
      "text part 0 not found",
      "text part X not found",
    ]) {
      const exit = await run(message)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toEqual([])
    }
  })

  test("tolerates surrounding whitespace via trim", async () => {
    const exit = await run("  reasoning part 0 not found  ")
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("still fails on genuine provider errors", async () => {
    for (const error of ["rate limit exceeded", 'Tool "foo" not found', "context length exceeded", new Error("boom")]) {
      const exit = await run(error)
      expect(Exit.isFailure(exit)).toBe(true)
    }
  })
})

describe("LLMAISDK.toLLMEvents orphan delta repair", () => {
  test("synthesizes a reasoning-start for an orphan reasoning-delta", async () => {
    const events = await runStream([
      { type: "reasoning-delta", id: "rs_1", text: "thinking" } as AnyEvent,
      { type: "reasoning-delta", id: "rs_1", text: " more" } as AnyEvent,
    ])
    // Start is synthesized exactly once, then both deltas flow through.
    expect(events.map((e) => e.type)).toEqual(["reasoning-start", "reasoning-delta", "reasoning-delta"])
    expect(events[0].id).toBe("rs_1")
    expect(events[1].text).toBe("thinking")
    expect(events[2].text).toBe(" more")
  })

  test("carries providerMetadata onto the synthesized start so signatures survive", async () => {
    const metadata = { anthropic: { signature: "sig-abc" } }
    const events = await runStream([
      { type: "reasoning-delta", id: "rs_2", text: "x", providerMetadata: metadata } as AnyEvent,
    ])
    expect(events[0].type).toBe("reasoning-start")
    expect(events[0].providerMetadata).toEqual(metadata)
  })

  test("synthesizes a text-start for an orphan text-delta", async () => {
    const events = await runStream([{ type: "text-delta", id: "t_1", text: "hello" } as AnyEvent])
    expect(events.map((e) => e.type)).toEqual(["text-start", "text-delta"])
    expect(events[0].id).toBe("t_1")
  })

  test("synthesizes a start for an orphan reasoning-end", async () => {
    const events = await runStream([{ type: "reasoning-end", id: "rs_3" } as AnyEvent])
    expect(events.map((e) => e.type)).toEqual(["reasoning-start", "reasoning-end"])
  })

  test("does not duplicate the start when the provider emits one", async () => {
    const events = await runStream([
      { type: "reasoning-start", id: "rs_4" } as AnyEvent,
      { type: "reasoning-delta", id: "rs_4", text: "a" } as AnyEvent,
      { type: "reasoning-end", id: "rs_4" } as AnyEvent,
      { type: "text-start", id: "t_2" } as AnyEvent,
      { type: "text-delta", id: "t_2", text: "b" } as AnyEvent,
      { type: "text-end", id: "t_2" } as AnyEvent,
    ])
    // Well-formed streams must be passed through completely unchanged.
    expect(events.map((e) => e.type)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-end",
    ])
  })
})
