import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Evolution } from "@/evolution/index"
import { Config } from "@/config/config"
import { EvolutionContextLayer } from "@/evolution/context/register"

// ===============================================================
// Sprint C-Verify — AD-CP03-02: T-08-WIRE-COVERAGE
// ===============================================================

const mockConfig = Config.Service.of({
  get: () => Effect.succeed({ evolution: { enabled: true } } as any),
  getGlobal: () => Effect.succeed({} as any),
  getConsoleState: () => Effect.succeed({} as any),
  update: () => Effect.void,
  updateGlobal: () => Effect.succeed({} as any),
  directories: () => Effect.succeed([]),
  invalidate: () => Effect.void,
  waitForDependencies: () => Effect.void,
})

const mockEvolution = Evolution.Service.of({
  memory: () => ({
    all: () => Effect.succeed([]),
    save: () =>
      Effect.succeed({ id: "mock", content: "", type: "lesson", tags: [], created: 0, updated: 0 }),
    retrieve: () => Effect.succeed([]),
    search: () => Effect.succeed([]),
    summarize: () => Effect.succeed({ count: 0, lastUpdate: null, types: {} }),
    compact: () => Effect.void,
  }),
  decisions: () => ({
    list: () => Effect.succeed([]),
    get: () => Effect.succeed(undefined),
    save: () =>
      Effect.succeed({
        id: "ADR-mock", title: "", status: "proposed", context: "",
        decision: "", consequences: "", tags: [], createdAt: 0, updatedAt: 0,
      }),
    supersede: () => Effect.void,
    summarize: () => Effect.succeed({ count: 0 }),
  }),
  project: () => ({
    profile: () =>
      Effect.succeed({
        root: "/mock", name: "mock", vcs: "git", languages: ["ts"],
        frameworks: [], packages: [], structure: "single",
        hasDocker: false, hasTests: false, hasCI: false, detectedAt: 0,
      }),
    detectFrameworks: () => Effect.succeed([]),
    getStructure: () => Effect.succeed("single"),
    hasDependency: () => Effect.succeed(false),
    refresh: () => Effect.succeed({}),
  }),
  status: () =>
    Effect.succeed({
      enabled: true,
      mode: "observe" as const,
      memory: { count: 0, lastUpdate: null },
      decisions: { count: 0 },
      project: { detected: false, root: "", frameworks: [] },
    }),
  getConfig: () => Effect.succeed({}),
  getMemories: () => Effect.succeed([]),
  getDecisions: () => Effect.succeed([]),
  getProjectContext: () => Effect.succeed({} as any),
})

const baseLayer = Layer.mergeAll(
  Layer.succeed(Config.Service, mockConfig),
  Layer.succeed(Evolution.Service, mockEvolution),
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
    const brokenConfig = Config.Service.of({
      get: () => Effect.die(new Error("config failure")),
      getGlobal: () => Effect.die(new Error("config failure")),
      getConsoleState: () => Effect.succeed({} as any),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed({} as any),
      directories: () => Effect.succeed([]),
      invalidate: () => Effect.void,
      waitForDependencies: () => Effect.void,
    })

    const composedLayer = Layer.mergeAll(
      Layer.succeed(Config.Service, brokenConfig),
      Layer.succeed(Evolution.Service, mockEvolution),
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
