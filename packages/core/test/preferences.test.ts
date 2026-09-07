import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Preferences } from "@opencode-ai/core/preferences"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Preferences.node, Bus.node])))
const target = { kind: "skill.activation", id: "effect" }

describe("Preferences", () => {
  it.effect("rejects unknown kinds and invalid values without replacing the previous value or emitting an update", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const bus = yield* Bus.Service
      const updates: string[] = []
      yield* preferences.set(target, "disabled")
      yield* bus.listen((event) =>
        Effect.sync(() => {
          updates.push(event.type)
        }),
      )
      expect(yield* preferences.set(target, false).pipe(Effect.flip)).toBeInstanceOf(Preferences.InvalidValueError)
      expect(yield* preferences.set({ kind: "unregistered", id: "global" }, {}).pipe(Effect.flip)).toBeInstanceOf(
        Preferences.InvalidValueError,
      )
      expect(yield* preferences.get(target)).toBe("disabled")
      expect(updates).toEqual([])
    }),
  )

  it.effect("publishes global invalidations after the override is persisted", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const bus = yield* Bus.Service
      const observed: (Preferences.Value | undefined)[] = []
      yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Preferences.Event.Updated.type) return
          expect(event.location).toBeUndefined()
          observed.push(yield* preferences.get(target))
        }),
      )
      yield* preferences.set(target, "disabled")
      yield* preferences.reset(target)
      expect(observed).toEqual(["disabled", undefined])
    }),
  )
})
