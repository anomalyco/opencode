import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Evolution } from "@/evolution/index"
import { Config } from "@/config/config"
import { EvolutionContextLayer } from "@/evolution/context/register"

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
      Layer.provideMerge(Layer.succeed(Config.Service, mockConfig)),
      Layer.provideMerge(Layer.succeed(Evolution.Service, mockEvolution)),
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
