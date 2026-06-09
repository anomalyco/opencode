import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class A extends Context.Service<A, { readonly value: "a" }>()("test/A") {}
class B extends Context.Service<B, { readonly value: "b" }>()("test/B") {}
class C extends Context.Service<C, { readonly value: "c" }>()("test/C") {}
class LayerError {
  readonly _tag = "LayerError"
}
class NotFoundError {
  readonly _tag = "NotFoundError"
}
class DiskError {
  readonly _tag = "DiskError"
}
class NetworkError {
  readonly _tag = "NetworkError"
}

const aImplementation = Layer.succeed(A, A.of({ value: "a" }))
const bImplementation = Layer.effect(
  B,
  Effect.gen(function* () {
    yield* A
    return B.of({ value: "b" })
  }),
)
const cImplementation = Layer.effect(
  C,
  Effect.gen(function* () {
    yield* A
    yield* B
    return C.of({ value: "c" })
  }),
)
const failingAImplementation = Layer.effect(A, Effect.fail(new LayerError()))
const notFoundAImplementation = Layer.effect(A, Effect.fail(new NotFoundError()))
const diskAImplementation = Layer.effect(A, Effect.fail(new DiskError()))
const networkAImplementation = Layer.effect(A, Effect.fail(new NetworkError()))
const notFoundOrDiskAImplementation = Layer.effect(A, Effect.fail(new NotFoundError() as NotFoundError | DiskError))

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

type AProvides = Assert<Equal<Layer.Success<typeof aImplementation>, A>>
type ARequires = Assert<Equal<Layer.Services<typeof aImplementation>, never>>
type BProvides = Assert<Equal<Layer.Success<typeof bImplementation>, B>>
type BRequires = Assert<Equal<Layer.Services<typeof bImplementation>, A>>
type CRequires = Assert<Equal<Layer.Services<typeof cImplementation>, A | B>>
void (0 as unknown as AProvides)
void (0 as unknown as ARequires)
void (0 as unknown as BProvides)
void (0 as unknown as BRequires)
void (0 as unknown as CRequires)

const a = LayerNode.make(aImplementation, [])
const b = LayerNode.make(bImplementation, [a])
const c = LayerNode.make(cImplementation, [a, b])
const failingA = LayerNode.make(failingAImplementation, [])
const bWithFailingA = LayerNode.make(bImplementation, [failingA])
const notFoundA = LayerNode.make(notFoundAImplementation, [])
const diskA = LayerNode.make(diskAImplementation, [])
const networkA = LayerNode.make(networkAImplementation, [])
const notFoundOrDiskA = LayerNode.make(notFoundOrDiskAImplementation, [])

// @ts-expect-error B requires A
LayerNode.make(bImplementation, [])

// @ts-expect-error C requires both A and B
LayerNode.make(cImplementation, [a])

type ANodeProvides = Assert<Equal<typeof a, LayerNode.Node<A, never>>>
type BNodeProvides = Assert<Equal<typeof b, LayerNode.Node<B, never>>>
type CNodeProvides = Assert<Equal<typeof c, LayerNode.Node<C, never>>>
type FailingANodeError = Assert<Equal<typeof failingA, LayerNode.Node<A, LayerError>>>
type DependentNodeError = Assert<Equal<typeof bWithFailingA, LayerNode.Node<B, LayerError>>>
void (0 as unknown as ANodeProvides)
void (0 as unknown as BNodeProvides)
void (0 as unknown as CNodeProvides)
void (0 as unknown as FailingANodeError)
void (0 as unknown as DependentNodeError)

const closed = LayerNode.buildLayer(c)
const closedWithError = LayerNode.buildLayer(bWithFailingA)
type ClosedProvides = Assert<Equal<Layer.Success<typeof closed>, C>>
type ClosedRequires = Assert<Equal<Layer.Services<typeof closed>, never>>
type ClosedError = Assert<Equal<Layer.Error<typeof closedWithError>, LayerError>>
void (0 as unknown as ClosedProvides)
void (0 as unknown as ClosedRequires)
void (0 as unknown as ClosedError)

const replacement = LayerNode.make(Layer.succeed(A, A.of({ value: "a" })), [])
LayerNode.replace(a, replacement)
LayerNode.replace(notFoundOrDiskA, notFoundA)
LayerNode.replace(notFoundOrDiskA, diskA)

// @ts-expect-error An override for A must still provide A
LayerNode.replace(a, b)

// @ts-expect-error A replacement cannot introduce NetworkError
LayerNode.replace(notFoundOrDiskA, networkA)

test("type exploration compiles", () => {})
