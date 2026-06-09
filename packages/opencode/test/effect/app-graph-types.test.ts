import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { build, node, replace, type Node } from "@/effect/app-graph"

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
const bImplementation = Layer.effect(B, Effect.gen(function* () {
  yield* A
  return B.of({ value: "b" })
}))
const cImplementation = Layer.effect(C, Effect.gen(function* () {
  yield* A
  yield* B
  return C.of({ value: "c" })
}))
const failingAImplementation = Layer.effect(A, Effect.fail(new LayerError()))
const notFoundAImplementation = Layer.effect(A, Effect.fail(new NotFoundError()))
const diskAImplementation = Layer.effect(A, Effect.fail(new DiskError()))
const networkAImplementation = Layer.effect(A, Effect.fail(new NetworkError()))
const notFoundOrDiskAImplementation = Layer.effect(
  A,
  Effect.fail(new NotFoundError() as NotFoundError | DiskError),
)

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

const a = node(aImplementation, [])
const b = node(bImplementation, [a])
const c = node(cImplementation, [a, b])
const failingA = node(failingAImplementation, [])
const bWithFailingA = node(bImplementation, [failingA])
const notFoundA = node(notFoundAImplementation, [])
const diskA = node(diskAImplementation, [])
const networkA = node(networkAImplementation, [])
const notFoundOrDiskA = node(notFoundOrDiskAImplementation, [])

// @ts-expect-error B requires A
node(bImplementation, [])

// @ts-expect-error C requires both A and B
node(cImplementation, [a])

type ANodeProvides = Assert<Equal<typeof a, Node<A, never>>>
type BNodeProvides = Assert<Equal<typeof b, Node<B, never>>>
type CNodeProvides = Assert<Equal<typeof c, Node<C, never>>>
type FailingANodeError = Assert<Equal<typeof failingA, Node<A, LayerError>>>
type DependentNodeError = Assert<Equal<typeof bWithFailingA, Node<B, LayerError>>>
void (0 as unknown as ANodeProvides)
void (0 as unknown as BNodeProvides)
void (0 as unknown as CNodeProvides)
void (0 as unknown as FailingANodeError)
void (0 as unknown as DependentNodeError)

const closed = build(c)
const closedWithError = build(bWithFailingA)
type ClosedProvides = Assert<Equal<Layer.Success<typeof closed>, C>>
type ClosedRequires = Assert<Equal<Layer.Services<typeof closed>, never>>
type ClosedError = Assert<Equal<Layer.Error<typeof closedWithError>, LayerError>>
void (0 as unknown as ClosedProvides)
void (0 as unknown as ClosedRequires)
void (0 as unknown as ClosedError)

const replacement = node(Layer.succeed(A, A.of({ value: "a" })), [])
replace(a, replacement)
replace(notFoundOrDiskA, notFoundA)
replace(notFoundOrDiskA, diskA)

// @ts-expect-error An override for A must still provide A
replace(a, b)

// @ts-expect-error A replacement cannot introduce NetworkError
replace(notFoundOrDiskA, networkA)

test("type exploration compiles", () => {})
