import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Settings } from "@opencode/core/settings"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Settings.node, Bus.node])))
const target = { kind: "skill.activation", id: "effect" }

describe("Settings", () => {
  it.effect("rejects unknown kinds and invalid values without replacing the previous value or emitting an update", () =>
    Effect.gen(function* () {
      const settings = yield* Settings.Service
      const bus = yield* Bus.Service
      const updates: string[] = []
      yield* settings.set(target, "disabled")
      yield* bus.listen((event) =>
        Effect.sync(() => {
          updates.push(event.type)
        }),
      )
      expect(yield* settings.set(target, false).pipe(Effect.flip)).toBeInstanceOf(Settings.InvalidValueError)
      expect(yield* settings.set({ kind: "unregistered", id: "global" }, {}).pipe(Effect.flip)).toBeInstanceOf(
        Settings.InvalidValueError,
      )
      expect(yield* settings.get(target)).toBe("disabled")
      expect(updates).toEqual([])
    }),
  )

  it.effect("publishes global invalidations after the override is persisted", () =>
    Effect.gen(function* () {
      const settings = yield* Settings.Service
      const bus = yield* Bus.Service
      const observed: (Settings.Value | undefined)[] = []
      yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Settings.Event.Updated.type) return
          expect(event.location).toBeUndefined()
          observed.push(yield* settings.get(target))
        }),
      )
      yield* settings.set(target, "disabled")
      yield* settings.reset(target)
      expect(observed).toEqual(["disabled", undefined])
    }),
  )
})
