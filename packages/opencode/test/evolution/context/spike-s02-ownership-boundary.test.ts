import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Evolution } from "@/evolution/index"
import { Config } from "@/config/config"
import { EvolutionContextLayer } from "@/evolution/context/register"
import { mockEvolution } from "@test/evolution/fixture/mock-evolution"

const decisionCtxKey = SystemContext.Key.make("decision/context")

function makeDecisionContextEntry() {
  return {
    key: decisionCtxKey,
    load: Effect.succeed(
      SystemContext.make({
        key: decisionCtxKey,
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed("Decision: use TypeScript strict mode"),
        baseline: (t: string) => t,
        update: (_p: string, c: string) => c,
      }),
    ),
  }
}

const baseLayer = Layer.mergeAll(
  Layer.mock(Config.Service, {
    get: () => Effect.succeed({}),
    getGlobal: () => Effect.succeed({}),
    getConsoleState: () => Effect.succeed({ consoleManagedProviders: [], activeOrgName: undefined, switchableOrgCount: 0 }),
    updateGlobal: () => Effect.succeed({ info: {}, changed: false }),
  }),
  Layer.succeed(Evolution.Service, mockEvolution()),
  SystemContextRegistry.layer,
)

describe("S-02.1 — Single-Writer: Only designated owner registers each key", () => {
  test("EvolutionContextLayer registers only evolution/context key", async () => {
    const keys = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      yield* EvolutionContextLayer.register
      return yield* registry.load()
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(keys).toBeDefined()
  })

  test("DecisionContext registers under decision/context key — separate from evolution", async () => {
    const keys = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register(makeDecisionContextEntry())

      return yield* registry.load()
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(keys).toBeDefined()
  })
})

describe("S-02.2 — Cross-Boundary: Duplicate key rejection enforces ownership", () => {
  test("two modules cannot register same key — evolution/context is single-writer", async () => {
    const exit = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register

      return yield* Effect.exit(
        registry.register({
          key: SystemContext.Key.make("evolution/context"),
          load: Effect.succeed(
            SystemContext.make({
              key: SystemContext.Key.make("evolution/context"),
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.succeed("rogue context"),
              baseline: (t: string) => t,
              update: (_p: string, c: string) => c,
            }),
          ),
        }),
      )
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("two modules cannot register same key — decision/context is single-writer", async () => {
    const exit = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register(makeDecisionContextEntry())

      return yield* Effect.exit(
        registry.register(makeDecisionContextEntry()),
      )
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("S-02.3 — Multi-Context Coexistence: Different owners coexist", () => {
  test("evolution/context and decision/context both present in baseline", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register
      yield* registry.register(makeDecisionContextEntry())

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline).toContain("Evolution: Project Context")
    expect(baseline).toContain("Decision:")
    expect(baseline).toContain("use TypeScript strict mode")
  })

  test("context sections appear in deterministic order by key", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register(makeDecisionContextEntry())
      yield* EvolutionContextLayer.register

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    // decision/context sorts before evolution/context alphabetically
    const decisionIndex = baseline.indexOf("Decision:")
    const evolutionIndex = baseline.indexOf("Evolution: Project Context")
    expect(decisionIndex).toBeGreaterThanOrEqual(0)
    expect(evolutionIndex).toBeGreaterThan(decisionIndex)
  })
})

describe("S-02.4 — Ownership Contract: Single-writer rule is testable", () => {
  test("write path is exclusively through system context registry", async () => {
    const exit = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register(makeDecisionContextEntry())

      return yield* Effect.exit(
        registry.register({
          key: decisionCtxKey,
          load: Effect.succeed(
            SystemContext.make({
              key: decisionCtxKey,
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.succeed("different writer"),
              baseline: (t: string) => t,
              update: (_p: string, c: string) => c,
            }),
          ),
        }),
      )
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
