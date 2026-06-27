import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class A extends Context.Service<A, {}>()("test/TagA") {}
class B extends Context.Service<B, {}>()("test/TagB") {}
class C extends Context.Service<C, {}>()("test/TagC") {}

const tags = LayerNode.tags({ request: ["global"], global: [] })
const request = tags.make("request")
const global = tags.make("global")
const globalA = global({ service: A, layer: Layer.succeed(A, A.of({})), deps: [] })
const requestA = request({ service: A, layer: Layer.succeed(A, A.of({})), deps: [] })
const requestB = request({ service: B, layer: Layer.succeed(B, B.of({})), deps: [] })
const bLayer = Layer.effect(B, Effect.as(A, B.of({})))
const cLayer = Layer.effect(
  C,
  Effect.gen(function* () {
    yield* A
    yield* B
    return C.of({})
  }),
)

const requestInput = LayerNode.unbound(A, tags.values.request)
const globalInput = LayerNode.unbound(B, tags.values.global)
const inputs = LayerNode.group([requestInput, globalInput])
void inputs

request({ service: B, layer: bLayer, deps: [globalA] })
request({ service: C, layer: cLayer, deps: [globalA, requestB] })
request({ service: C, layer: cLayer, deps: [LayerNode.group([globalA, requestB])] })
request({ service: B, layer: bLayer, deps: [LayerNode.unbound(A, tags.values.request)] })

// @ts-expect-error Tag configuration can only reference declared tags
LayerNode.tags({ request: ["missing"], global: [] })

// @ts-expect-error An unrelated dependency cannot satisfy A
request({ service: B, layer: bLayer, deps: [requestB] })

// @ts-expect-error Providing only A leaves B missing
request({ service: C, layer: cLayer, deps: [globalA] })

// @ts-expect-error Providing only B leaves A missing
request({ service: C, layer: cLayer, deps: [requestB] })

// @ts-expect-error Duplicate A providers still leave B missing
request({ service: C, layer: cLayer, deps: [globalA, requestA] })

// @ts-expect-error A group with only A still leaves B missing
request({ service: C, layer: cLayer, deps: [LayerNode.group([globalA])] })

// @ts-expect-error Global cannot depend on request
global({ service: B, layer: bLayer, deps: [requestA] })

// @ts-expect-error Groups preserve their child tags
global({ service: B, layer: bLayer, deps: [LayerNode.group([requestA])] })

test("type exploration compiles", () => {})
