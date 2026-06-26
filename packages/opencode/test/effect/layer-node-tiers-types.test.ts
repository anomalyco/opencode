import { test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

class A extends Context.Service<A, {}>()("test/TierA") {}
class B extends Context.Service<B, {}>()("test/TierB") {}

const tiers = LayerNode.tiers(["request", "global"])
const request = tiers.make("request")
const global = tiers.make("global")
const globalA = global({ service: A, layer: Layer.succeed(A, A.of({})), deps: [] })
const bLayer = Layer.effect(B, Effect.as(A, B.of({})))

request({ service: B, layer: bLayer, deps: [globalA] })

// @ts-expect-error Global cannot depend on request
global({ service: B, layer: bLayer, deps: [request({ service: A, layer: Layer.succeed(A, A.of({})), deps: [] })] })

test("type exploration compiles", () => {})
