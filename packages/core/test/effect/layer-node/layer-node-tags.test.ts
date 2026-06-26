import { expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodeTree } from "@opencode-ai/core/effect/layer-node"
import { Node } from "@opencode-ai/core/effect/node"
import { NodeBuild } from "@opencode-ai/core/effect/node-build"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { Location } from "@opencode-ai/core/location"

class Value extends Context.Service<Value, { readonly value: string }>()("test/TagValue") {}
class Result extends Context.Service<Result, { readonly value: string }>()("test/TagResult") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/TagLeft") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/TagRight") {}
class Last extends Context.Service<Last, { readonly value: string }>()("test/TagLast") {}

test("returns a composed tagged layer", async () => {
  const tags = LayerNode.tags({ location: ["global"], global: [] })
  const global = tags.make("global")
  const location = tags.make("location")
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
  const serviceLayer = NodeBuild.build(LayerNode.group([result]))
  const layer = LocationServiceMap.get({ directory: "/tmp" } as Location.Ref).pipe(
    Layer.provide(serviceLayer),
  ) as unknown as Layer.Layer<Result>
  const program = Effect.gen(function* () {
    return (yield* Result).value
  }).pipe(Effect.provide(layer))

  expect(await Effect.runPromise(program)).toBe("value")
})

test("rejects conflicting hoisted service implementations", () => {
  const tags = LayerNode.tags({ location: ["global"], global: [] })
  const global = tags.make("global")
  const location = tags.make("location")
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

  expect(() => NodeBuild.build(LayerNode.group([left, right]))).toThrow(
    "conflicting implementations for test/TagValue",
  )
})

test("rebinds same-tag providers without reacquiring them", async () => {
  let firstAcquisitions = 0
  const tags = LayerNode.tags({ global: [] })
  const global = tags.make("global")
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
  const layer = NodeBuild.build(LayerNode.group([left, right, last])) as Layer.Layer<Left | Right | Last>
  const values = Effect.gen(function* () {
    return [(yield* Left).value, (yield* Right).value, (yield* Last).value]
  }).pipe(Effect.provide(layer))

  expect(await Effect.runPromise(values)).toEqual(["first", "second", "first"])
  expect(firstAcquisitions).toBe(1)
})
