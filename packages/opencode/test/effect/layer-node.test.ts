import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class Value extends Context.Service<Value, { readonly value: string }>()("test/LayerNodeValue") {}
class Greeting extends Context.Service<Greeting, { readonly value: string }>()("test/LayerNodeGreeting") {}
class Left extends Context.Service<Left, { readonly value: string }>()("test/LayerNodeLeft") {}
class Right extends Context.Service<Right, { readonly value: string }>()("test/LayerNodeRight") {}

const tiers = LayerNode.tiers(["app"])
const make = tiers.make("app")
const valueLayer = Layer.succeed(Value, Value.of({ value: "production" }))
const greetingLayer = Layer.effect(
  Greeting,
  Effect.map(Value, (value) => Greeting.of({ value: `hello ${value.value}` })),
)
const value = make({ service: Value, layer: valueLayer, deps: [] })
const greeting = make({ service: Greeting, layer: greetingLayer, deps: [value] })

describe("layer node", () => {
  test("builds an untiered graph", async () => {
    const value = LayerNode.make({ service: Value, layer: valueLayer, deps: [] })
    const greeting = LayerNode.make({ service: Greeting, layer: greetingLayer, deps: [value] })
    const program = Effect.map(Greeting, (item) => item.value).pipe(Effect.provide(LayerNode.buildLayer(greeting)))
    expect(await Effect.runPromise(program)).toBe("hello production")
  })

  test("builds a dependency graph", async () => {
    const program = Effect.map(Greeting, (item) => item.value).pipe(
      Effect.provide(LayerNode.buildLayer(greeting, { tiers })),
    )
    expect(await Effect.runPromise(program)).toBe("hello production")
  })

  test("replaces a layer by identity", async () => {
    const replacement = Layer.succeed(Value, Value.of({ value: "simulation" }))
    const program = Effect.map(Greeting, (item) => item.value).pipe(
      Effect.provide(
        LayerNode.buildLayer(greeting, { tiers, replacements: [LayerNode.replace(valueLayer, replacement)] }),
      ),
    )
    expect(await Effect.runPromise(program)).toBe("hello simulation")
  })

  test("replaces every use of the same layer", async () => {
    const leftLayer = Layer.effect(
      Left,
      Effect.map(Value, (item) => Left.of({ value: item.value })),
    )
    const rightLayer = Layer.effect(
      Right,
      Effect.map(Value, (item) => Right.of({ value: item.value })),
    )
    const left = make({ service: Left, layer: leftLayer, deps: [value] })
    const right = make({ service: Right, layer: rightLayer, deps: [value] })
    const replacement = Layer.succeed(Value, Value.of({ value: "replaced" }))
    const layer = LayerNode.buildLayer(LayerNode.group([left, right]), {
      tiers,
      replacements: [LayerNode.replace(valueLayer, replacement)],
    })
    const program = Effect.gen(function* () {
      return [(yield* Left).value, (yield* Right).value]
    }).pipe(Effect.provide(layer))
    expect(await Effect.runPromise(program)).toEqual(["replaced", "replaced"])
  })

  test("does not acquire an unused replacement", async () => {
    let acquisitions = 0
    const other = Layer.succeed(Value, Value.of({ value: "other" }))
    const replacement = Layer.effect(
      Value,
      Effect.sync(() => {
        acquisitions++
        return Value.of({ value: "replacement" })
      }),
    )
    await Effect.runPromise(
      Effect.map(Greeting, (item) => item.value).pipe(
        Effect.provide(
          LayerNode.buildLayer(greeting, { tiers, replacements: [LayerNode.replace(other, replacement)] }),
        ),
      ),
    )
    expect(acquisitions).toBe(0)
  })
})
