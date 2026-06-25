import { expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class Value extends Context.Service<Value, { readonly value: string }>()("test/TierValue") {}
class Result extends Context.Service<Result, { readonly value: string }>()("test/TierResult") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/TierLeft") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/TierRight") {}
class Last extends Context.Service<Last, { readonly value: string }>()("test/TierLast") {}

test("builds tiers with a custom builder", async () => {
  let locationBuilds = 0
  const tiers = LayerNode.tiers(["location", "global"])
  const global = tiers.make("global")
  const location = tiers.make("location")
  const value = global({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "value" })), deps: [] })
  const result = location({
    service: Result,
    layer: Layer.effect(
      Result,
      Effect.gen(function* () {
        return Result.of({ value: (yield* Value).value })
      }),
    ),
    deps: [value],
  })
  const layer = LayerNode.buildLayer(LayerNode.group([result]), {
    tiers,
    buildTier: (tier, layers) => {
      if (tier !== "location") return LayerNode.combine(layers)
      locationBuilds++
      return LayerNode.combine(layers).pipe(Layer.fresh)
    },
  })
  const program = Effect.gen(function* () {
    return (yield* Result).value
  }).pipe(Effect.provide(layer))

  expect(await Effect.runPromise(program)).toBe("value")
  expect(locationBuilds).toBe(1)
})

test("rejects conflicting higher-tier service implementations", () => {
  const tiers = LayerNode.tiers(["location", "global"])
  const global = tiers.make("global")
  const location = tiers.make("location")
  const first = global({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "first" })), deps: [] })
  const second = global({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "second" })), deps: [] })
  const left = location({
    service: Left,
    layer: Layer.effect(Left, Effect.as(Value, Left.of({ value: "left" }))),
    deps: [first],
  })
  const right = location({
    service: Right,
    layer: Layer.effect(Right, Effect.as(Value, Right.of({ value: "right" }))),
    deps: [second],
  })

  expect(() => LayerNode.buildLayer(LayerNode.group([left, right]), { tiers })).toThrow(
    "conflicting implementations for test/TierValue",
  )
})

test("validates tier dependencies through groups", () => {
  const tiers = LayerNode.tiers(["location", "global"])
  const global = tiers.make("global")
  const location = tiers.make("location")
  const local = location({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "local" })), deps: [] })
  const invalid = global({
    service: Result,
    layer: Layer.effect(
      Result,
      Effect.map(Value, (value) => Result.of({ value: value.value })),
    ),
    deps: [LayerNode.group([local])],
  })

  expect(() => LayerNode.buildLayer(invalid, { tiers })).toThrow("Tier global cannot depend on lower tier location")
})

test("validates shared groups in each consumer tier", () => {
  const tiers = LayerNode.tiers(["location", "global"])
  const global = tiers.make("global")
  const location = tiers.make("location")
  const local = location({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "local" })), deps: [] })
  const shared = LayerNode.group([local])
  const valid = location({
    service: Left,
    layer: Layer.effect(
      Left,
      Effect.map(Value, (value) => Left.of({ value: value.value })),
    ),
    deps: [shared],
  })
  const invalid = global({
    service: Result,
    layer: Layer.effect(
      Result,
      Effect.map(Value, (value) => Result.of({ value: value.value })),
    ),
    deps: [shared],
  })

  expect(() => LayerNode.buildLayer(LayerNode.group([valid, invalid]), { tiers })).toThrow(
    "Tier global cannot depend on lower tier location",
  )
})

test("rejects a service assigned to multiple tiers", () => {
  const tiers = LayerNode.tiers(["location", "global"])
  const global = tiers.make("global")
  const location = tiers.make("location")
  const local = location({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "local" })), deps: [] })
  const shared = global({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "global" })), deps: [] })

  expect(() => LayerNode.buildLayer(LayerNode.group([local, shared]), { tiers })).toThrow(
    "Service test/TierValue belongs to both tier location and tier global",
  )
})

test("rebinds same-tier providers without reacquiring them", async () => {
  let firstAcquisitions = 0
  const tiers = LayerNode.tiers(["global"])
  const global = tiers.make("global")
  const first = global({
    service: Value,
    layer: Layer.effect(
      Value,
      Effect.sync(() => {
        firstAcquisitions++
        return Value.of({ value: "first" })
      }),
    ),
    deps: [],
  })
  const second = global({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "second" })), deps: [] })
  const left = global({
    service: Left,
    layer: Layer.effect(
      Left,
      Effect.map(Value, (value) => Left.of({ value: value.value })),
    ),
    deps: [first],
  })
  const right = global({
    service: Right,
    layer: Layer.effect(
      Right,
      Effect.map(Value, (value) => Right.of({ value: value.value })),
    ),
    deps: [second],
  })
  const last = global({
    service: Last,
    layer: Layer.effect(
      Last,
      Effect.map(Value, (value) => Last.of({ value: value.value })),
    ),
    deps: [first],
  })
  const layer = LayerNode.buildLayer(LayerNode.group([left, right, last]), { tiers })
  const values = Effect.gen(function* () {
    return [(yield* Left).value, (yield* Right).value, (yield* Last).value]
  }).pipe(Effect.provide(layer))

  expect(await Effect.runPromise(values)).toEqual(["first", "second", "first"])
  expect(firstAcquisitions).toBe(1)
})
