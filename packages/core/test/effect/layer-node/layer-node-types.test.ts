import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/core/effect/app-node"

class A extends Context.Service<A, {}>()("test/LayerNodeA") {}
class B extends Context.Service<B, {}>()("test/LayerNodeB") {}
class C extends Context.Service<C, {}>()("test/LayerNodeC") {}
class LayerError {
  readonly _tag = "LayerError"
}
class OtherError {
  readonly _tag = "OtherError"
}

const tags = LayerNode.tags({ app: [] })
const make = tags.make("app")
const build = <A, E>(root: LayerNode.Node<A, E, any>) => LayerNode.compile(root) as Layer.Layer<A, E>
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
const inputA = LayerNode.unbound(A, tags.values.app)
const inputDependent = make({ service: B, layer: bLayer, deps: [inputA] })

make({ name: "manual-a", layer: aLayer, deps: [] })

// @ts-expect-error A node must have a service or name
make({ layer: aLayer, deps: [] })

// @ts-expect-error Service and name are mutually exclusive
make({ service: A, name: "a", layer: aLayer, deps: [] })

// @ts-expect-error B requires A
make({ service: B, layer: bLayer, deps: [] })

// @ts-expect-error C requires A and B
make({ service: C, layer: cLayer, deps: [a] })

const closed = build(LayerNode.group([c]))
const closedWithError = build(LayerNode.group([dependent]))
const checkClosed: Layer.Layer<C, never, never> = closed
const checkError: Layer.Layer<B, LayerError, never> = closedWithError
void checkClosed
void checkError

LayerNode.compile(a, [[a, Layer.succeed(A, A.of({}))]])
LayerNode.compile(a, [[a, make({ service: A, layer: Layer.succeed(A, A.of({})), deps: [] })]])

// @ts-expect-error Replacement must provide A
LayerNode.compile(a, [[a, Layer.succeed(B, B.of({}))]])

// @ts-expect-error Node replacement must provide A
const invalidNodeReplacement = () => LayerNode.compile(a, [[a, b]])
void invalidNodeReplacement

// @ts-expect-error Replacement cannot introduce a new error
LayerNode.compile(a, [[a, Layer.effect(A, Effect.fail(new OtherError()))]])

// @ts-expect-error Node replacement cannot introduce a new error
const invalidNodeErrorReplacement = () =>
  LayerNode.compile(a, [[a, make({ service: A, layer: Layer.effect(A, Effect.fail(new OtherError())), deps: [] })]])
void invalidNodeErrorReplacement

class TagA extends Context.Service<TagA, {}>()("test/TagA") {}
class TagB extends Context.Service<TagB, {}>()("test/TagB") {}
class TagC extends Context.Service<TagC, {}>()("test/TagC") {}

const scopedTags = LayerNode.tags({ request: ["global"], global: [] })
const request = scopedTags.make("request")
const global = scopedTags.make("global")
const globalA = global({ service: TagA, layer: Layer.succeed(TagA, TagA.of({})), deps: [] })
const requestA = request({ service: TagA, layer: Layer.succeed(TagA, TagA.of({})), deps: [] })
const requestB = request({ service: TagB, layer: Layer.succeed(TagB, TagB.of({})), deps: [] })
const tagBLayer = Layer.effect(TagB, Effect.as(TagA, TagB.of({})))
const tagCLayer = Layer.effect(
  TagC,
  Effect.gen(function* () {
    yield* TagA
    yield* TagB
    return TagC.of({})
  }),
)

request({ service: TagB, layer: tagBLayer, deps: [globalA] })
request({ service: TagC, layer: tagCLayer, deps: [globalA, requestB] })
request({ service: TagC, layer: tagCLayer, deps: [LayerNode.group([globalA, requestB])] })

// @ts-expect-error Tag configuration can only reference declared tags
LayerNode.tags({ request: ["missing"], global: [] })

// @ts-expect-error An unrelated dependency cannot satisfy TagA
request({ service: TagB, layer: tagBLayer, deps: [requestB] })

// @ts-expect-error Providing only TagA leaves TagB missing
request({ service: TagC, layer: tagCLayer, deps: [globalA] })

// @ts-expect-error Providing only TagB leaves TagA missing
request({ service: TagC, layer: tagCLayer, deps: [requestB] })

// @ts-expect-error Duplicate TagA providers still leave TagB missing
request({ service: TagC, layer: tagCLayer, deps: [globalA, requestA] })

// @ts-expect-error A group with only TagA still leaves TagB missing
request({ service: TagC, layer: tagCLayer, deps: [LayerNode.group([globalA])] })

// @ts-expect-error Global cannot depend on request
global({ service: TagB, layer: tagBLayer, deps: [requestA] })

// @ts-expect-error Groups preserve their child tags
global({ service: TagB, layer: tagBLayer, deps: [LayerNode.group([requestA])] })

class ScopedA extends Context.Service<ScopedA, {}>()("test/ScopedA") {}
class ScopedB extends Context.Service<ScopedB, {}>()("test/ScopedB") {}

const scopedA = Layer.succeed(ScopedA, ScopedA.of({}))
const scopedB = Layer.effect(ScopedB, Effect.as(ScopedA, ScopedB.of({})))
const globalScopedA = makeGlobalNode({ service: ScopedA, layer: scopedA, deps: [] })
const locationScopedA = makeLocationNode({ service: ScopedA, layer: scopedA, deps: [] })

makeGlobalNode({ service: ScopedB, layer: scopedB, deps: [globalScopedA] })
makeLocationNode({ service: ScopedB, layer: scopedB, deps: [globalScopedA] })
makeLocationNode({ service: ScopedB, layer: scopedB, deps: [locationScopedA] })

// @ts-expect-error Global nodes cannot depend on location nodes
makeGlobalNode({ service: ScopedB, layer: scopedB, deps: [locationScopedA] })

// @ts-expect-error ScopedB requires ScopedA
makeLocationNode({ service: ScopedB, layer: scopedB, deps: [] })

test("type exploration compiles", () => {})
