import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Config } from "@/config/config"
import { Evolution } from "@/evolution/index"
import { EvolutionContextLayer } from "@/evolution/context/register"
import { mockEvolution } from "../fixture/mock-evolution"

// ===============================================================
// Sprint C-Verify — AD-CP03-02: T-08-WIRE-COVERAGE
// ===============================================================

const baseLayer = Layer.mergeAll(
  Layer.mock(Config.Service, { get: () => Effect.succeed({}) }),
  Layer.succeed(Evolution.Service, mockEvolution()),
  SystemContextRegistry.layer,
)

const evolutionKey = SystemContext.Key.make("evolution/context")

// ---------------------------------------------------------------
// Criterion 1 — Executes Exactly Once
// ---------------------------------------------------------------

describe("C1 — Registration executes exactly once", () => {
  test("first registration produces valid baseline", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)

      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline.length).toBeGreaterThan(0)
    expect(baseline).toContain("Evolution: Project Context")
    expect(baseline).toContain("mock")
    expect(baseline).toContain("single")
  })

  test("second registration does not duplicate context", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register
      yield* EvolutionContextLayer.register

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)

      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline).toContain("Evolution: Project Context")
    const evolutionSections = baseline.match(/Evolution: Project Context/g)
    expect(evolutionSections).toHaveLength(1)
  })
})

// ---------------------------------------------------------------
// Criterion 2 — Duplicate Registration Behavior
// ---------------------------------------------------------------

describe("C2 — Duplicate registration does not crash", () => {
  test("calling register twice with catchDefect does not die", async () => {
    const exit = await Effect.gen(function* () {
      yield* EvolutionContextLayer.register
      return yield* Effect.exit(EvolutionContextLayer.register)
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("registering same key directly without catchDefect dies", async () => {
    const exit = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register({
        key: evolutionKey,
        load: Effect.succeed(
          SystemContext.make({
            key: evolutionKey,
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed("first"),
            baseline: (t: string) => t,
            update: (_p: string, c: string) => c,
          }),
        ),
      })

      return yield* Effect.exit(
        registry.register({
          key: evolutionKey,
          load: Effect.succeed(
            SystemContext.make({
              key: evolutionKey,
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.succeed("second"),
              baseline: (t: string) => t,
              update: (_p: string, c: string) => c,
            }),
          ),
        }),
      )
    }).pipe(Effect.scoped, Effect.provide(SystemContextRegistry.layer), Effect.runPromise)

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

// ---------------------------------------------------------------
// Criterion 3 — Deterministic Ordering
// ---------------------------------------------------------------

describe("C3 — Registration order is deterministic", () => {
  test("register before load produces consistent order", async () => {
    const baseline1 = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register
      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    const baseline2 = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register
      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline1).toBe(baseline2)
  })
})

// ---------------------------------------------------------------
// Criterion 4 — Registration Failure Is Observable
// ---------------------------------------------------------------

describe("C4 — Registration failure is observable", () => {
  test("register with failing config produces an Exit failure", async () => {
    const composedLayer = Layer.mergeAll(
      Layer.mock(Config.Service, { get: () => Effect.die(new Error("config failure")) }),
      Layer.succeed(Evolution.Service, mockEvolution()),
      SystemContextRegistry.layer,
    )

    const exit = await EvolutionContextLayer.register.pipe(
      Effect.scoped,
      Effect.provide(composedLayer),
      Effect.exit,
      Effect.runPromise,
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

// ---------------------------------------------------------------
// Criterion 5 — Registration Does Not Silently Disappear
// ---------------------------------------------------------------

describe("C5 — Registration does not silently disappear", () => {
  test("registered context survives scope reopening", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register

      const ctx1 = yield* registry.load()
      const gen1 = yield* SystemContext.initialize(ctx1)

      const ctx2 = yield* registry.load()
      const gen2 = yield* SystemContext.initialize(ctx2)

      expect(gen1.baseline).toBe(gen2.baseline)
      return gen1.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline).toContain("Evolution: Project Context")
  })
})
