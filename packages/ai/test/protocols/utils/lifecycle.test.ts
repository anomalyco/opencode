import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Lifecycle } from "../../../src/protocols/utils/lifecycle.js"
import { LLMEvent } from "../../../src/schema/events.js"
import { it } from "../../lib/effect"

describe("Lifecycle", () => {
  it.effect("closes open reasoning before starting a new overlapping one", () =>
    Effect.gen(function* () {
      const state = Lifecycle.initial()
      const events: LLMEvent[] = []

      // Start reasoning block 0
      const s1 = Lifecycle.reasoningStart(state, events, "reasoning-0")
      expect(s1.reasoning).toEqual(new Set(["reasoning-0"]))
      expect(events).toEqual([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-0" }),
      ])

      // Start overlapping reasoning block 1 - should close block 0 first
      const s2 = Lifecycle.reasoningStart(s1, events, "reasoning-1")
      expect(s2.reasoning).toEqual(new Set(["reasoning-1"]))

      expect(events).toEqual([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-0" }),
        LLMEvent.reasoningEnd({ id: "reasoning-0" }),
        LLMEvent.reasoningStart({ id: "reasoning-1" }),
      ])
    }),
  )

  it.effect("closes open text before starting a new overlapping one", () =>
    Effect.gen(function* () {
      const state = Lifecycle.initial()
      const events: LLMEvent[] = []

      // Start text block 0
      const s1 = Lifecycle.textStart(state, events, "text-0")
      expect(s1.text).toEqual(new Set(["text-0"]))
      expect(events).toEqual([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-0" }),
      ])

      // Start overlapping text block 1 - should close block 0 first
      const s2 = Lifecycle.textStart(s1, events, "text-1")
      expect(s2.text).toEqual(new Set(["text-1"]))

      expect(events).toEqual([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-0" }),
        LLMEvent.textEnd({ id: "text-0" }),
        LLMEvent.textStart({ id: "text-1" }),
      ])
    }),
  )

  it.effect("does not close when re-starting the same fragment", () =>
    Effect.gen(function* () {
      const state = Lifecycle.initial()
      const events: LLMEvent[] = []

      const s1 = Lifecycle.reasoningStart(state, events, "reasoning-0")
      const s2 = Lifecycle.reasoningStart(s1, events, "reasoning-0")

      expect(s2.reasoning).toEqual(new Set(["reasoning-0"]))
      expect(events).toEqual([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-0" }),
      ])
    }),
  )

  it.effect("keeps unrelated fragments open when starting a new one", () =>
    Effect.gen(function* () {
      const state = Lifecycle.initial()
      const events: LLMEvent[] = []

      // Open text-0 and reasoning-0
      const s1 = Lifecycle.textStart(state, events, "text-0")
      const s2 = Lifecycle.reasoningStart(s1, events, "reasoning-0")

      // Start overlapping text-1 - should close text-0 but keep reasoning-0
      const s3 = Lifecycle.textStart(s2, events, "text-1")
      expect(s3.text).toEqual(new Set(["text-1"]))
      expect(s3.reasoning).toEqual(new Set(["reasoning-0"]))

      expect(events).toEqual([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-0" }),
        LLMEvent.reasoningStart({ id: "reasoning-0" }),
        LLMEvent.textEnd({ id: "text-0" }),
        LLMEvent.textStart({ id: "text-1" }),
      ])
    }),
  )

  it.effect("ends all open fragments on finish", () =>
    Effect.gen(function* () {
      const state = Lifecycle.initial()
      const events: LLMEvent[] = []

      const s1 = Lifecycle.textStart(state, events, "text-0")
      const s2 = Lifecycle.reasoningStart(s1, events, "reasoning-0")

      const s3 = Lifecycle.finish(s2, events, { reason: { normalized: "stop" } })
      expect(s3.text).toEqual(new Set())
      expect(s3.reasoning).toEqual(new Set())

      expect(events).toContainEqual(LLMEvent.textEnd({ id: "text-0" }))
      expect(events).toContainEqual(LLMEvent.reasoningEnd({ id: "reasoning-0" }))
    }),
  )
})
