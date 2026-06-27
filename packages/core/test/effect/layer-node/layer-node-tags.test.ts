import { expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Node } from "@opencode-ai/core/effect/node"
import { NodeBuild } from "@opencode-ai/core/effect/node-build"

class Value extends Context.Service<Value, { readonly value: string }>()("test/TagValue") {}
class Result extends Context.Service<Result, { readonly value: string }>()("test/TagResult") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/TagLeft") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/TagRight") {}
class Last extends Context.Service<Last, { readonly value: string }>()("test/TagLast") {}

test("returns a composed tagged layer", async () => {
  const value = Node.makeGlobalNode({ service: Value, layer: Layer.succeed(Value, Value.of({ value: "value" })), deps: [] })
  const result = Node.makeGlobalNode({
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
  const program = Effect.gen(function* () {
    return (yield* Result).value
  }).pipe(Effect.provide(serviceLayer))

  expect(await Effect.runPromise(program)).toBe("value")
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
