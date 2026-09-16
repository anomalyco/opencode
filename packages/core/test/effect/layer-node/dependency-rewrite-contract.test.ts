import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

// Contract tests for LayerNode identity and multi-dependency provision.
// These assert production contracts that hold on HEAD and on the corrected
// tree (HEAD + Layer.mergeAll in compile). They deliberately do NOT cover
// falsy dependency entries: the Node types forbid null/undefined, no
// producer in the repo emits them, and such inputs must fail fast instead
// of being silently dropped.

class Alpha extends Context.Service<Alpha, { readonly value: string }>()("test/C3Alpha") {}
class Beta extends Context.Service<Beta, { readonly value: string }>()("test/C3Beta") {}
class Other extends Context.Service<Other, { readonly value: string }>()("test/C3Other") {}

const tags = LayerNode.tags({ app: [] })
const makeApp = tags.make("app")
const alphaLayer = Layer.succeed(Alpha, Alpha.of({ value: "a" }))

describe("layer node contracts", () => {
  test("hoist preserves the identity of nodes untouched by replacements", () => {
    const alpha = LayerNode.make({ service: Alpha, layer: alphaLayer, deps: [] })
    const beta = makeApp({
      service: Beta,
      layer: Layer.succeed(Beta, Beta.of({ value: "b" })),
      deps: [alpha],
    })
    const other = LayerNode.make({
      service: Other,
      layer: Layer.succeed(Other, Other.of({ value: "o" })),
      deps: [],
    })
    const replacement = Layer.succeed(Other, Other.of({ value: "r" }))
    const result = LayerNode.hoist(LayerNode.group([beta]), tags.values.app, [[other, replacement]])
    const hoistedBeta = result.hoisted.dependencies[0]
    expect(hoistedBeta).toMatchObject({ name: beta.name })
    expect(hoistedBeta).toBe(beta)
  })

  test("hoist rebuilds a node whose dependency is actually replaced", () => {
    const alpha = LayerNode.make({ service: Alpha, layer: alphaLayer, deps: [] })
    const beta = makeApp({
      service: Beta,
      layer: Layer.succeed(Beta, Beta.of({ value: "b" })),
      deps: [alpha],
    })
    const replacement = Layer.succeed(Alpha, Alpha.of({ value: "replaced" }))
    const result = LayerNode.hoist(LayerNode.group([beta]), tags.values.app, [[alpha, replacement]])
    const hoistedBeta = result.hoisted.dependencies[0]
    expect(hoistedBeta).not.toBe(beta)
    expect(hoistedBeta?.dependencies[0]).toMatchObject({ name: alpha.name })
    expect(hoistedBeta?.dependencies[0]).not.toBe(alpha)
  })

  test("compile provides all direct dependencies of a node (mergeAll)", async () => {
    const alpha = LayerNode.make({ service: Alpha, layer: alphaLayer, deps: [] })
    const beta = LayerNode.make({
      service: Beta,
      layer: Layer.succeed(Beta, Beta.of({ value: "b" })),
      deps: [],
    })
    class Gamma extends Context.Service<Gamma, { readonly value: string }>()("test/C3Gamma") {}
    const gammaImpl = Layer.effect(
      Gamma,
      Effect.gen(function* () {
        const a = yield* Alpha
        const b = yield* Beta
        return Gamma.of({ value: a.value + b.value })
      }),
    )
    const gamma = LayerNode.make({ service: Gamma, layer: gammaImpl, deps: [alpha, beta] })
    const program = Effect.map(Gamma, (item) => item.value).pipe(
      Effect.provide(LayerNode.compile(LayerNode.group([gamma]))),
    )
    expect(await Effect.runPromise(program)).toBe("ab")
  })
})
