import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/core/effect/scoped-node"

class A extends Context.Service<A, {}>()("test/ScopedA") {}
class B extends Context.Service<B, {}>()("test/ScopedB") {}

const a = Layer.succeed(A, A.of({}))
const b = Layer.effect(B, Effect.as(A, B.of({})))
const globalA = makeGlobalNode({ service: A, layer: a, deps: [] })
const locationA = makeLocationNode({ service: A, layer: a, deps: [] })

makeGlobalNode({ service: B, layer: b, deps: [globalA] })
makeLocationNode({ service: B, layer: b, deps: [globalA] })
makeLocationNode({ service: B, layer: b, deps: [locationA] })

// @ts-expect-error Global nodes cannot depend on location nodes
makeGlobalNode({ service: B, layer: b, deps: [locationA] })

// @ts-expect-error B requires A
makeLocationNode({ service: B, layer: b, deps: [] })

test("type exploration compiles", () => {})
