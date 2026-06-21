import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContextBuiltIns } from "@opencode-ai/core/system-context/builtins"
import { Location } from "@opencode-ai/core/location"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Config } from "@/config/config"
import { Evolution } from "@/evolution/index"
import { EvolutionContextLayer } from "@/evolution/context/register"

// ===============================================================
// T-09 — Production Path Trace
// ===============================================================
// Prove the complete production path:
// LocationServiceMap.get(ref) → lookup() → extraRegistrations → registry.load()
// → SystemContext.initialize() → baseline contains evolution context markers
//
// Uses real SystemContextBuiltIns.locationLayer (not mocked).
// registerExtra(EvolutionContextLayer.register) is called once,
// matching the production wiring in app-runtime.ts:57.

// --- Fixtures ---

const directory = AbsolutePath.make(FSUtil.resolve("/repo/packages/core"))
const projectDirectory = AbsolutePath.make(FSUtil.resolve("/repo"))

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of({
    directory,
    project: {
      directory: projectDirectory,
    },
    vcs: { type: "git" as const, store: AbsolutePath.make(FSUtil.resolve("/repo/.git")) },
  }),
)

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

// Register once — matches production wiring (app-runtime.ts:57)
SystemContextBuiltIns.registerExtra(EvolutionContextLayer.register)

// Compose the full production layer chain
const productionLayer = SystemContextBuiltIns.locationLayer.pipe(
  Layer.provideMerge(Layer.succeed(Config.Service, mockConfig)),
  Layer.provideMerge(Layer.succeed(Evolution.Service, mockEvolution)),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layerWith({ config: "/global" })),
  Layer.provide(locationLayer),
)

// --- Tests ---

describe("T-09 — Production Path Trace", () => {
  test("LocationServiceMap.get() activates EvolutionContextLayer", async () => {
    const ctx = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      return yield* registry.load()
    }).pipe(Effect.scoped, Effect.provide(productionLayer), Effect.runPromise)

    expect(ctx).toBeDefined()
  })

  test("baseline contains evolution context markers", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(productionLayer), Effect.runPromise)

    expect(baseline).toContain("Evolution: Project Context")
    expect(baseline).toContain("Name: mock")
    expect(baseline).toContain("Structure: single")
  })

  test("lookup() receives registerExtra extensions", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(productionLayer), Effect.runPromise)

    // Environment + date from core/builtins
    expect(baseline).toContain("Working directory:")
    expect(baseline).toContain("Today's date:")
    expect(baseline).toContain("<env>")

    // Evolution context from registerExtra extension
    expect(baseline).toContain("Evolution:")
  })

  test("lookup() executes registerExtra extensions", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service
      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(productionLayer), Effect.runPromise)

    // Both environment and evolution sections present — proves extraRegistrations loop ran
    const envIndex = baseline.indexOf("<env>")
    const evolutionIndex = baseline.indexOf("Evolution: Project Context")
    expect(envIndex).toBeGreaterThanOrEqual(0)
    expect(evolutionIndex).toBeGreaterThan(envIndex)
  })})
