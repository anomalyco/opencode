import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Config } from "@/config/config"
import { Evolution } from "@/evolution/index"
import { EvolutionContextLayer } from "@/evolution/context/register"
import { mockEvolution } from "../fixture/mock-evolution"

const duplicateKey = SystemContext.Key.make("test/duplicate")

function makeDuplicateEntry() {
  return {
    key: duplicateKey,
    load: Effect.succeed(
      SystemContext.make({
        key: duplicateKey,
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed("data"),
        baseline: (t: string) => t,
        update: (_p: string, c: string) => c,
      }),
    ),
  }
}

// ---------------------------------------------------------------
// Q4 — Duplicate Registration Protection
// ---------------------------------------------------------------

describe("Q4 — Duplicate Registration Protection", () => {
  test("registering same key twice triggers Effect.die", async () => {
    const exit = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register(makeDuplicateEntry())

      return yield* Effect.exit(
        registry.register(makeDuplicateEntry()),
      )
    }).pipe(
      Effect.scoped,
      Effect.provide(SystemContextRegistry.layer),
      Effect.runPromise,
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

// ---------------------------------------------------------------
// D-02 — DF-10 Runtime Trace (Evolution → Registry → SystemContext)
// ---------------------------------------------------------------

describe("D-02 — DF-10 Runtime Trace", () => {
  test("EvolutionContextLayer.layer registers → load → initialize", async () => {
    const composedLayer = EvolutionContextLayer.layer.pipe(
      Layer.provideMerge(Layer.mock(Config.Service, { get: () => Effect.succeed({}) })),
      Layer.provideMerge(Layer.succeed(Evolution.Service, mockEvolution())),
      Layer.provideMerge(SystemContextRegistry.layer),
    )

    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      const systemContext = yield* registry.load()
      expect(systemContext).toBeDefined()

      const generation = yield* SystemContext.initialize(systemContext)
      expect(generation.baseline).toBeDefined()
      expect(generation.baseline.length).toBeGreaterThan(0)

      return generation.baseline
    }).pipe(
      Effect.scoped,
      Effect.provide(composedLayer),
      Effect.runPromise,
    )

    expect(baseline.length).toBeGreaterThan(0)
  })
})
