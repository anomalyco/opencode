import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { KV } from "@opencode-ai/core/kv"
import { Preferences } from "@opencode-ai/core/preferences"
import { migrate } from "@opencode-ai/core/preferences/migrate"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Preferences.configured({
        definitions: {
          "test.boolean": Schema.Boolean,
          "test.number": Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
          "test.text": Schema.String,
          "test.list": Schema.Array(Schema.String),
          "test.options": Schema.NullOr(Schema.Struct({ names: Schema.Array(Schema.String), count: Schema.Int })),
        },
      }),
      KV.node,
      Bus.node,
    ]),
  ),
)
const target = (id: string): Preferences.Target => ({ kind: "skill.activation", id })

describe("Preferences", () => {
  it.effect("supports schema-validated booleans, numbers, strings, arrays, objects, and explicit null values", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const entries: Preferences.Entry[] = [
        { target: { kind: "test.boolean", id: "global" }, value: false },
        { target: { kind: "test.number", id: "global" }, value: 0 },
        { target: { kind: "test.text", id: "global" }, value: "" },
        { target: { kind: "test.list", id: "global" }, value: [] },
        { target: { kind: "test.options", id: "custom" }, value: { names: ["one", "two"], count: 2 } },
        { target: { kind: "test.options", id: "none" }, value: null },
      ]
      yield* Effect.forEach(entries, (entry) => preferences.set(entry.target, entry.value))
      yield* Effect.forEach(entries, (entry) =>
        Effect.gen(function* () {
          expect(yield* preferences.get(entry.target)).toEqual(entry.value)
        }),
      )
      expect(yield* preferences.list()).toEqual(expect.arrayContaining(entries))
      yield* preferences.reset({ kind: "test.options", id: "none" })
      expect(yield* preferences.get({ kind: "test.options", id: "none" })).toBeUndefined()
      expect(yield* preferences.get({ kind: "test.boolean", id: "global" })).toBe(false)
    }),
  )

  it.effect("rejects unknown kinds and invalid values without replacing the previous value or emitting an update", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const bus = yield* Bus.Service
      const updates: string[] = []
      yield* preferences.set(target("effect"), "disabled")
      yield* bus.listen((event) =>
        Effect.sync(() => {
          updates.push(event.type)
        }),
      )
      expect(yield* preferences.set(target("effect"), false).pipe(Effect.flip)).toBeInstanceOf(
        Preferences.InvalidValueError,
      )
      expect(yield* preferences.set({ kind: "test.number", id: "global" }, -1).pipe(Effect.flip)).toBeInstanceOf(
        Preferences.InvalidValueError,
      )
      expect(yield* preferences.set({ kind: "unregistered", id: "global" }, {}).pipe(Effect.flip)).toBeInstanceOf(
        Preferences.InvalidValueError,
      )
      expect(yield* preferences.get(target("effect"))).toBe("disabled")
      expect(updates).toEqual([])
    }),
  )

  it.effect("migrates previous skill toggles without overwriting newer values", () =>
    Effect.gen(function* () {
      const preferences = yield* Preferences.Service
      const kv = yield* KV.Service
      yield* kv.set('preferences:activation:["skill","effect"]', {
        target: { kind: "skill", id: "effect" },
        state: "disabled",
      })
      yield* kv.set('preferences:activation:["skill","review"]', {
        target: { kind: "skill", id: "review" },
        state: "disabled",
      })
      yield* preferences.set(target("review"), "enabled")
      yield* migrate(kv)
      yield* migrate(kv)
      expect(yield* preferences.get(target("effect"))).toBe("disabled")
      expect(yield* preferences.get(target("review"))).toBe("enabled")
      expect((yield* kv.scan({ prefix: "preferences:activation:" })).entries).toEqual([])
    }),
  )

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
        { target: target("effect"), value: "disabled" },
        { target: target("review:/雪"), value: "enabled" },
      ])

      yield* preferences.set(target("effect"), "enabled")
      expect(yield* preferences.get(target("effect"))).toBe("enabled")
      yield* preferences.reset(target("effect"))
      yield* preferences.reset(target("effect"))
      expect(yield* preferences.get(target("effect"))).toBeUndefined()
      expect(yield* preferences.list()).toEqual([{ target: target("review:/雪"), value: "enabled" }])
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
      yield* kv.set("preferences:values:invalid", { value: "unknown" })
      expect(yield* preferences.list()).toHaveLength(1001)
      expect(yield* kv.get("preferences:values:invalid")).toEqual({ value: "unknown" })
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
          observed.push(yield* preferences.get(target("effect")))
        }),
      )
      yield* preferences.set(target("effect"), "disabled")
      yield* preferences.reset(target("effect"))
      expect(observed).toEqual(["disabled", undefined])
    }),
  )
})
