import { describe, expect, test } from "bun:test"
import type { LLMEvent } from "../src/schema/index.js"
import { Lifecycle } from "../src/protocols/utils/lifecycle.js"

const reason = { normalized: "stop", raw: "stop" } as const
const signed = { test: { signature: "sig" } }

const summary = (events: ReadonlyArray<LLMEvent>) =>
  events.map((event) => {
    if (!("id" in event)) return event.type
    if ("providerMetadata" in event && event.providerMetadata) return `${event.type}:${event.id}:metadata`
    return `${event.type}:${event.id}`
  })

describe("Lifecycle", () => {
  test("finish closes open blocks in the order they started", () => {
    const events: LLMEvent[] = []
    const opened = Lifecycle.reasoningStart(Lifecycle.textStart(Lifecycle.initial(), events, "text-0"), events, "r-1")
    const state = Lifecycle.textStart(opened, events, "text-2")

    expect(summary(events)).toEqual(["step-start", "text-start:text-0", "reasoning-start:r-1", "text-start:text-2"])
    expect(state.phase).toBe("step")
    events.length = 0
    expect(Lifecycle.finish(state, events, { reason })).toEqual({ phase: "finished", open: [] })
    expect(summary(events)).toEqual([
      "text-end:text-0",
      "reasoning-end:r-1",
      "text-end:text-2",
      "step-finish",
      "finish",
    ])
  })

  test("stored metadata is sent when a block ends without its own", () => {
    const events: LLMEvent[] = []
    const opened = Lifecycle.setMetadata(
      Lifecycle.reasoningStart(Lifecycle.initial(), events, "reasoning-0"),
      "reasoning",
      "reasoning-0",
      signed,
    )
    Lifecycle.finish(opened, events, { reason })
    Lifecycle.reasoningEnd(opened, events, "reasoning-0")
    Lifecycle.reasoningEnd(opened, events, "reasoning-0", { test: { other: true } })

    expect(events.filter((event) => event.type === "reasoning-end")).toMatchObject([
      { providerMetadata: signed },
      { providerMetadata: signed },
      { providerMetadata: { test: { other: true } } },
    ])
  })

  test("ignores events after finish", () => {
    const events: LLMEvent[] = []
    const finished = Lifecycle.finish(Lifecycle.textDelta(Lifecycle.initial(), events, "text-0", "a"), events, {
      reason,
    })
    events.length = 0
    const after = Lifecycle.finish(
      Lifecycle.reasoningDelta(
        Lifecycle.textDelta(Lifecycle.stepStart(finished, events), events, "text-1", "b"),
        events,
        "reasoning-0",
        "c",
      ),
      events,
      { reason },
    )

    expect(events).toEqual([])
    expect(after).toEqual(finished)
  })
})
