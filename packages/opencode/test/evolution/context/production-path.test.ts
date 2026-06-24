import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContextBuiltIns } from "@opencode-ai/core/system-context/builtins"
import { Location } from "@opencode-ai/core/location"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Project } from "@opencode-ai/core/project"
import { Config } from "@/config/config"
import { Evolution } from "@/evolution/index"
import { EvolutionContextLayer } from "@/evolution/context/register"
import { mockEvolution } from "@test/evolution/fixture/mock-evolution"

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
      id: Project.ID.make(""),
      directory: projectDirectory,
    },
    vcs: { type: "git" as const, store: AbsolutePath.make(FSUtil.resolve("/repo/.git")) },
  }),
)

// Register once — matches production wiring (app-runtime.ts:57)
SystemContextBuiltIns.registerExtra(EvolutionContextLayer.register)

// Compose the full production layer chain
const productionLayer = SystemContextBuiltIns.locationLayer.pipe(
  Layer.provideMerge(Layer.mock(Config.Service, {
    get: () => Effect.succeed({}),
    getGlobal: () => Effect.succeed({}),
    getConsoleState: () => Effect.succeed({ consoleManagedProviders: [], activeOrgName: undefined, switchableOrgCount: 0 }),
    update: () => Effect.void,
    updateGlobal: () => Effect.succeed({ info: {}, changed: false }),
    directories: () => Effect.succeed([]),
    invalidate: () => Effect.void,
    waitForDependencies: () => Effect.void,
  })),
  Layer.provideMerge(Layer.succeed(Evolution.Service, mockEvolution())),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.layerWith({ config: "/global" })),
  Layer.provide(locationLayer),
)

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(effect.pipe(Effect.provide(productionLayer)) as Effect.Effect<A, E>)

// --- Tests ---

describe("T-09 — Production Path Trace", () => {
  test("LocationServiceMap.get() activates EvolutionContextLayer", async () => {
    const ctx = await run(
      Effect.gen(function* () {
        const registry = yield* SystemContextRegistry.Service
        return yield* registry.load()
      }).pipe(Effect.scoped),
    )

    expect(ctx).toBeDefined()
  })

  test("baseline contains evolution context markers", async () => {
    const baseline = await run(
      Effect.gen(function* () {
        const registry = yield* SystemContextRegistry.Service
        const ctx = yield* registry.load()
        const gen = yield* SystemContext.initialize(ctx)
        return gen.baseline
      }).pipe(Effect.scoped),
    )

    expect(baseline).toContain("Evolution: Project Context")
    expect(baseline).toContain("Name: mock")
    expect(baseline).toContain("Structure: single")
  })

  test("lookup() receives registerExtra extensions", async () => {
    const baseline = await run(
      Effect.gen(function* () {
        const registry = yield* SystemContextRegistry.Service
        const ctx = yield* registry.load()
        const gen = yield* SystemContext.initialize(ctx)
        return gen.baseline
      }).pipe(Effect.scoped),
    )

    // Environment + date from core/builtins
    expect(baseline).toContain("Working directory:")
    expect(baseline).toContain("Today's date:")
    expect(baseline).toContain("<env>")

    // Evolution context from registerExtra extension
    expect(baseline).toContain("Evolution:")
  })

  test("lookup() executes registerExtra extensions", async () => {
    const baseline = await run(
      Effect.gen(function* () {
        const registry = yield* SystemContextRegistry.Service
        const ctx = yield* registry.load()
        const gen = yield* SystemContext.initialize(ctx)
        return gen.baseline
      }).pipe(Effect.scoped),
    )

    // Both environment and evolution sections present — proves extraRegistrations loop ran
    const envIndex = baseline.indexOf("<env>")
    const evolutionIndex = baseline.indexOf("Evolution: Project Context")
    expect(envIndex).toBeGreaterThanOrEqual(0)
    expect(evolutionIndex).toBeGreaterThan(envIndex)
  })})
