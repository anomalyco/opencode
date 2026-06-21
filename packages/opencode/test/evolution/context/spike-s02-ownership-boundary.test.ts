import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Evolution } from "@/evolution/index"
import { Config } from "@/config/config"
import { EvolutionContextLayer } from "@/evolution/context/register"

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
    save: () => Effect.succeed({ id: "mock", content: "", type: "lesson", tags: [], created: 0, updated: 0 }),
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
