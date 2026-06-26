import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class A extends Context.Service<A, {}>()("test/LayerNodeA") {}
class B extends Context.Service<B, {}>()("test/LayerNodeB") {}
class C extends Context.Service<C, {}>()("test/LayerNodeC") {}
class LayerError {
  readonly _tag = "LayerError"
}
class OtherError {
  readonly _tag = "OtherError"
}

const tiers = LayerNode.tiers(["app"])
const make = tiers.make("app")
const aLayer = Layer.succeed(A, A.of({}))
const bLayer = Layer.effect(B, Effect.as(A, B.of({})))
const cLayer = Layer.effect(
  C,
  Effect.gen(function* () {
    yield* A
    yield* B
    return C.of({})
  }),
)
const failingA = Layer.effect(A, Effect.fail(new LayerError()))
const a = make({ service: A, layer: aLayer, deps: [] })
const b = make({ service: B, layer: bLayer, deps: [a] })
const c = make({ service: C, layer: cLayer, deps: [a, b] })
const failing = make({ service: A, layer: failingA, deps: [] })
const dependent = make({ service: B, layer: bLayer, deps: [failing] })

make({ name: "manual-a", layer: aLayer, deps: [] })

// @ts-expect-error A node must have a service or name
make({ layer: aLayer, deps: [] })

// @ts-expect-error Service and name are mutually exclusive
make({ service: A, name: "a", layer: aLayer, deps: [] })

// @ts-expect-error B requires A
make({ service: B, layer: bLayer, deps: [] })

// @ts-expect-error C requires A and B
make({ service: C, layer: cLayer, deps: [a] })

const closed = LayerNode.buildLayer(c, { tiers })
const closedWithError = LayerNode.buildLayer(dependent, { tiers })
const checkClosed: Layer.Layer<C, never, never> = closed
const checkError: Layer.Layer<B, LayerError, never> = closedWithError
void checkClosed
void checkError

LayerNode.replace(aLayer, Layer.succeed(A, A.of({})))

// @ts-expect-error Replacement must provide A
LayerNode.replace(aLayer, Layer.succeed(B, B.of({})))

// @ts-expect-error Replacement cannot introduce a new error
LayerNode.replace(aLayer, Layer.effect(A, Effect.fail(new OtherError())))

// @ts-expect-error Replacement must be closed
LayerNode.replace(bLayer, bLayer)

test("type exploration compiles", () => {})
