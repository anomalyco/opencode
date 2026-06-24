import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Evolution } from "@/evolution/index"
import { Config } from "@/config/config"
import { EvolutionContextLayer } from "@/evolution/context/register"
import { mockEvolution } from "@test/evolution/fixture/mock-evolution"

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

function makeEntry(key: string, content: string) {
  const ctxKey = SystemContext.Key.make(key)
  return {
    key: ctxKey,
    load: Effect.succeed(
      SystemContext.make({
        key: ctxKey,
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(content),
        baseline: (t: string) => t,
        update: (_p: string, c: string) => c,
      }),
    ),
  }
}

describe("S-01.1 — Two extensions via direct registry", () => {
  test("two different keys register and load into baseline", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register(makeEntry("test/ext-one", "Extension One"))
      yield* registry.register(makeEntry("test/ext-two", "Extension Two"))

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline).toContain("Extension One")
    expect(baseline).toContain("Extension Two")
  })
})

describe("S-01.2 — Three extensions via direct registry", () => {
  test("three different keys all present in baseline", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* registry.register(makeEntry("test/alpha", "Alpha extension"))
      yield* registry.register(makeEntry("test/beta", "Beta extension"))
      yield* registry.register(makeEntry("test/gamma", "Gamma extension"))

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline).toContain("Alpha extension")
    expect(baseline).toContain("Beta extension")
    expect(baseline).toContain("Gamma extension")
  })
})

describe("S-01.3 — Evolution + extra extensions coexist", () => {
  test("evolution context and test extension both in baseline", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register
      yield* registry.register(makeEntry("test/extra", "Extra extension content"))

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    expect(baseline).toContain("Evolution: Project Context")
    expect(baseline).toContain("Extra extension content")
  })
})

describe("S-01.4 — Deterministic sorting by key", () => {
  test("registry.load() sorts entries alphabetically by key", async () => {
    const baseline = await Effect.gen(function* () {
      const registry = yield* SystemContextRegistry.Service

      yield* EvolutionContextLayer.register
      yield* registry.register(makeEntry("test/zzz-last", "Should appear last"))
      yield* registry.register(makeEntry("test/aaa-first", "Should appear first"))

      const ctx = yield* registry.load()
      const gen = yield* SystemContext.initialize(ctx)
      return gen.baseline
    }).pipe(Effect.scoped, Effect.provide(baseLayer), Effect.runPromise)

    const firstIndex = baseline.indexOf("Should appear first")
    const lastIndex = baseline.indexOf("Should appear last")
    expect(firstIndex).toBeGreaterThanOrEqual(0)
    expect(lastIndex).toBeGreaterThan(firstIndex)
  })
})
