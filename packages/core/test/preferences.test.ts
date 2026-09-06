import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { KV } from "@opencode-ai/core/kv"
import { Preferences } from "@opencode-ai/core/preferences"
import { Skill } from "@opencode-ai/schema/skill"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Preferences.node, KV.node, Bus.node])))
const target = (id: string): Preferences.Target => ({ kind: "skill", id: Skill.ID.make(id) })

describe("Preferences", () => {
  it.effect("persists explicit enabled and disabled choices and resets only the selected target", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const kv = yield* KV.Service
      expect(yield* preferences.get(target("effect"))).toBeUndefined()
      yield* Effect.all(
        [preferences.set(target("effect"), "disabled"), preferences.set(target("review:/雪"), "enabled")],
        { concurrency: "unbounded" },
      )
      expect(yield* preferences.get(target("effect"))).toBe("disabled")
      expect(yield* preferences.get(target("review:/雪"))).toBe("enabled")
      expect(yield* preferences.list()).toHaveLength(2)
      expect((yield* kv.scan({ prefix: "preferences:" })).entries.map((entry) => entry.value)).toEqual([
        { target: target("effect"), state: "disabled" },
        { target: target("review:/雪"), state: "enabled" },
      ])

      yield* preferences.set(target("effect"), "enabled")
      expect(yield* preferences.get(target("effect"))).toBe("enabled")
      yield* preferences.reset(target("effect"))
      yield* preferences.reset(target("effect"))
      expect(yield* preferences.get(target("effect"))).toBeUndefined()
      expect(yield* preferences.list()).toEqual([{ target: target("review:/雪"), state: "enabled" }])
    }),
  )

  it.effect("reads every KV page and ignores malformed stored entries without deleting them", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const kv = yield* KV.Service
      yield* Effect.forEach(
        Array.from({ length: 1001 }, (_, index) => target(`skill-${index}`)),
        (target) => preferences.set(target, "disabled"),
      )
      yield* kv.set("preferences:activation:invalid", { state: "unknown" })
      expect(yield* preferences.list()).toHaveLength(1001)
      expect(yield* kv.get("preferences:activation:invalid")).toEqual({ state: "unknown" })
    }),
  )

  it.effect("publishes global invalidations after the override is persisted", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const bus = yield* Bus.Service
      const observed: (Preferences.State | undefined)[] = []
      yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Preferences.Event.Updated.type) return
          expect(event.location).toBeUndefined()
          observed.push(yield* preferences.get(target("effect")))
        }),
      )
      yield* preferences.set(target("effect"), "disabled")
      yield* preferences.reset(target("effect"))
      expect(observed).toEqual(["disabled", undefined])
    }),
  )
})
