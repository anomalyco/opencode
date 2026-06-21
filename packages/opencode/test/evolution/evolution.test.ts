import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestConfig } from "../fixture/config"
import { EvolutionMemory } from "../../src/evolution/brain/memory"
import { EvolutionDecisions } from "../../src/evolution/brain/decisions"
import { EvolutionProject } from "../../src/evolution/brain/project"
import { EvolutionBrain } from "../../src/evolution/brain"
import { Evolution } from "@/evolution/index"
import { withTmpdirInstance } from "../fixture/fixture"

// Test config layer with evolution enabled/disabled
const enabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: true as const, mode: "assist" as const } }),
})
const disabledCfg = TestConfig.layer({
  get: () => Effect.succeed({ evolution: { enabled: false as const, mode: "observe" as const } }),
})

// Build self-contained layers (no remaining requirements)
const memoryLayer = EvolutionMemory.layer.pipe(Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)))
const decisionsLayer = EvolutionDecisions.layer.pipe(Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)))
const projectLayer = EvolutionProject.layer.pipe(Layer.provideMerge(Layer.mergeAll(enabledCfg, FSUtil.defaultLayer)))
const brainLayer = EvolutionBrain.layer.pipe(
  Layer.provideMerge(memoryLayer),
  Layer.provideMerge(decisionsLayer),
  Layer.provideMerge(projectLayer),
)
const subLayer = Layer.mergeAll(memoryLayer, decisionsLayer, projectLayer, brainLayer)
const evolutionLayer = Evolution.layer.pipe(Layer.provideMerge(subLayer))

// Disabled variants
const memoryLayerDisabled = EvolutionMemory.layer.pipe(Layer.provideMerge(Layer.mergeAll(disabledCfg, FSUtil.defaultLayer)))
const decisionsLayerDisabled = EvolutionDecisions.layer.pipe(Layer.provideMerge(Layer.mergeAll(disabledCfg, FSUtil.defaultLayer)))
const projectLayerDisabled = EvolutionProject.layer.pipe(Layer.provideMerge(Layer.mergeAll(disabledCfg, FSUtil.defaultLayer)))
const brainLayerDisabled = EvolutionBrain.layer.pipe(
  Layer.provideMerge(memoryLayerDisabled),
  Layer.provideMerge(decisionsLayerDisabled),
  Layer.provideMerge(projectLayerDisabled),
)
const subLayerDisabled = Layer.mergeAll(memoryLayerDisabled, decisionsLayerDisabled, projectLayerDisabled, brainLayerDisabled)
const evolutionLayerDisabled = Evolution.layer.pipe(Layer.provideMerge(subLayerDisabled))

const TIMEOUT = 30_000

const instanceTest = <E, R>(
  name: string,
  layer: Layer.Layer<any, any, any>,
  fn: () => Effect.Effect<void, E, R>,
) =>
  test(name, () => {
    const inner = fn().pipe(withTmpdirInstance({ git: true }), Effect.scoped)
    return Effect.runPromise(inner.pipe(Effect.provide(layer)) as Effect.Effect<void, E>)
  }, TIMEOUT)

const disabledTest = <E, R>(
  name: string,
  layer: Layer.Layer<any, any, any>,
  fn: () => Effect.Effect<void, E, R>,
) =>
  test(name, () => {
    const inner = fn().pipe(withTmpdirInstance({ git: true }), Effect.scoped)
    return Effect.runPromise(inner.pipe(Effect.provide(layer)) as Effect.Effect<void, E>)
  }, TIMEOUT)

// ============================================================
// Memory.Service
// ============================================================
describe("EvolutionMemory", () => {
  instanceTest("save creates a memory entry with id, created, updated", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      const entry = yield* svc.save({ type: "lesson", content: "test", tags: ["a"] })
      expect(entry.id).toBeTruthy()
      expect(entry.type).toBe("lesson")
      expect(entry.content).toBe("test")
      expect(entry.created).toBeGreaterThan(0)
      expect(entry.updated).toBeGreaterThan(0)
    }),
  )

  instanceTest("retrieve returns entries filtered by tags", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "pattern", content: "alpha", tags: ["x"] })
      yield* svc.save({ type: "pattern", content: "beta", tags: ["y"] })
      const result = yield* svc.retrieve({ tags: ["x"] })
      expect(result.length).toBe(1)
      expect(result[0].content).toBe("alpha")
    }),
  )

  instanceTest("retrieve filters by type", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "lesson", content: "l1", tags: [] })
      yield* svc.save({ type: "error", content: "e1", tags: [] })
      const result = yield* svc.retrieve({ type: "error" })
      expect(result.length).toBe(1)
      expect(result[0].type).toBe("error")
    }),
  )

  instanceTest("retrieve respects limit and returns most recent", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "observation", content: "old", tags: [] })
      yield* Effect.sleep("5 millis")
      yield* svc.save({ type: "observation", content: "new", tags: [] })
      const result = yield* svc.retrieve({ limit: 1 })
      expect(result.length).toBe(1)
      expect(result[0].content).toBe("new")
    }),
  )

  instanceTest("search returns matching entries", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "pattern", content: "use Effect.gen for composition", tags: ["effect"] })
      yield* svc.save({ type: "lesson", content: "avoid try/catch", tags: ["error-handling"] })
      const result = yield* svc.search("Effect")
      expect(result.length).toBe(1)
      expect(result[0].content).toInclude("Effect.gen")
    }),
  )

  instanceTest("search matches tags", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "pattern", content: "service pattern", tags: ["effect", "architecture"] })
      const result = yield* svc.search("architecture")
      expect(result.length).toBe(1)
    }),
  )

  instanceTest("search with limit returns at most N entries", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "observation", content: "a", tags: ["x"] })
      yield* svc.save({ type: "observation", content: "b", tags: ["x"] })
      yield* svc.save({ type: "observation", content: "c", tags: ["x"] })
      const result = yield* svc.search("x", 2)
      expect(result.length).toBe(2)
    }),
  )

  instanceTest("search returns empty array when no match", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      const result = yield* svc.search("nonexistent")
      expect(result).toEqual([])
    }),
  )

  instanceTest("summarize returns counts", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "lesson", content: "l1", tags: [] })
      yield* svc.save({ type: "error", content: "e1", tags: [] })
      yield* svc.save({ type: "error", content: "e2", tags: [] })
      const summary = yield* svc.summarize()
      expect(summary.count).toBe(3)
      expect(summary.types).toEqual({ lesson: 1, error: 2 })
      expect(summary.lastUpdate).toBeGreaterThan(0)
    }),
  )

  instanceTest("summarize returns zeroes when empty", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      const summary = yield* svc.summarize()
      expect(summary.count).toBe(0)
      expect(summary.lastUpdate).toBeNull()
      expect(summary.types).toEqual({})
    }),
  )

  instanceTest("all returns all entries", memoryLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      yield* svc.save({ type: "lesson", content: "x", tags: [] })
      yield* svc.save({ type: "lesson", content: "y", tags: [] })
      const all = yield* svc.all()
      expect(all.length).toBe(2)
    }),
  )

// NOTE: setup (510 O(n) saves) takes ~45s, compact() ~67ms.
  // TD-001 scope should be extended: O(n²) cumulative write cost as memory grows.
  // Compact test must disable the memory limit (maxMemoriesPerSession: 0) to write 510 entries.
  const memoryLayerNoLimit = EvolutionMemory.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(
      TestConfig.layer({
        get: () => Effect.succeed({ evolution: { enabled: true, mode: "assist" as const, maxMemoriesPerSession: 0 } }),
      }),
      FSUtil.defaultLayer,
    ))
  )
  test("compact retains most recent 500 entries",
    () =>
      Effect.gen(function* () {
        const svc = yield* EvolutionMemory.Service
        for (let i = 0; i < 510; i++) {
          yield* svc.save({ type: "observation", content: String(i), tags: [] })
        }
        yield* svc.compact()
        const all = yield* svc.all()
        expect(all.length).toBe(500)
      }).pipe(
        withTmpdirInstance({ git: true }),
        Effect.scoped,
        Effect.provide(memoryLayerNoLimit),
        Effect.runPromise,
      ),
    120_000,
  )

  // Disabled behavior
  disabledTest("all returns empty when evolution disabled", memoryLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      const result = yield* svc.all()
      expect(result).toEqual([])
    }),
  )

  disabledTest("search returns empty when evolution disabled", memoryLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      const result = yield* svc.search("anything")
      expect(result).toEqual([])
    }),
  )

  disabledTest("retrieve returns empty when evolution disabled", memoryLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      const result = yield* svc.retrieve({})
      expect(result).toEqual([])
    }),
  )

  disabledTest("summarize returns zeroes when evolution disabled", memoryLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionMemory.Service
      const result = yield* svc.summarize()
      expect(result.count).toBe(0)
      expect(result.lastUpdate).toBeNull()
      expect(result.types).toEqual({})
    }),
  )
})

// ============================================================
// DecisionRecord.Service
// ============================================================
describe("EvolutionDecisions", () => {
  instanceTest("save creates an ADR with id and timestamps", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      const adr = yield* svc.save({
        title: "Test Decision",
        status: "proposed",
        context: "testing",
        decision: "use effect",
        consequences: "better code",
        tags: ["test"],
      })
      expect(adr.id).toMatch(/^ADR-/)
      expect(adr.title).toBe("Test Decision")
      expect(adr.createdAt).toBeGreaterThan(0)
      expect(adr.updatedAt).toBeGreaterThan(0)
      expect(adr.status).toBe("proposed")
    }),
  )

  instanceTest("get retrieves saved ADR", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      const saved = yield* svc.save({
        title: "Find Me",
        status: "accepted",
        context: "ctx",
        decision: "dec",
        consequences: "cons",
        tags: [],
      })
      const found = yield* svc.get(saved.id)
      expect(found).toBeTruthy()
      expect(found!.title).toBe("Find Me")
    }),
  )

  instanceTest("get returns undefined for nonexistent ADR", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      const found = yield* svc.get("ADR-NONEXISTENT")
      expect(found).toBeUndefined()
    }),
  )

  instanceTest("list returns all ADRs sorted by createdAt desc", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      yield* Effect.sleep("5 millis")
      yield* svc.save({ title: "A", status: "accepted", context: "", decision: "", consequences: "", tags: [] })
      yield* Effect.sleep("5 millis")
      yield* svc.save({ title: "B", status: "proposed", context: "", decision: "", consequences: "", tags: [] })
      const all = yield* svc.list()
      expect(all.length).toBe(2)
      expect(all[0].createdAt).toBeGreaterThanOrEqual(all[1].createdAt)
    }),
  )

  instanceTest("list filters by status", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      yield* svc.save({ title: "A", status: "accepted", context: "", decision: "", consequences: "", tags: [] })
      yield* svc.save({ title: "B", status: "proposed", context: "", decision: "", consequences: "", tags: [] })
      const accepted = yield* svc.list("accepted")
      expect(accepted.length).toBe(1)
      expect(accepted[0].title).toBe("A")
    }),
  )

  instanceTest("search finds ADRs by title, context, decision, or tags", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      yield* svc.save({ title: "Use Effect", status: "accepted", context: "need better error handling", decision: "use Effect", consequences: "reliability", tags: ["effect"] })
      yield* svc.save({ title: "Use Express", status: "proposed", context: "http server", decision: "use express", consequences: "faster dev", tags: ["web"] })
      const byTitle = yield* svc.search("Effect")
      expect(byTitle.length).toBe(1)
      const byTag = yield* svc.search("web")
      expect(byTag.length).toBe(1)
      const byContext = yield* svc.search("error handling")
      expect(byContext.length).toBe(1)
    }),
  )

  instanceTest("summarize returns counts by status", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      yield* svc.save({ title: "A", status: "accepted", context: "", decision: "", consequences: "", tags: [] })
      yield* svc.save({ title: "B", status: "proposed", context: "", decision: "", consequences: "", tags: [] })
      yield* svc.save({ title: "C", status: "accepted", context: "", decision: "", consequences: "", tags: [] })
      const summary = yield* svc.summarize()
      expect(summary.count).toBe(3)
      expect(summary.byStatus).toEqual({ accepted: 2, proposed: 1 })
    }),
  )

  instanceTest("supersede marks old ADR and creates new one", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      const old = yield* svc.save({ title: "Old Way", status: "accepted", context: "ctx", decision: "old", consequences: "bad", tags: [] })
      const updated = yield* svc.supersede(old.id, { title: "New Way", status: "accepted", context: "ctx", decision: "new", consequences: "good", tags: [] })
      expect(updated.title).toBe("New Way")
      expect(updated.id).not.toBe(old.id)

      const superseded = yield* svc.get(old.id)
      expect(superseded!.status).toBe("superseded")
      expect(superseded!.supersededBy).toBe(updated.id)
    }),
  )

  instanceTest("supersede fails on nonexistent ADR", decisionsLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      const result = yield* Effect.exit(
        svc.supersede("ADR-NONE", { title: "X", status: "accepted", context: "", decision: "", consequences: "", tags: [] }),
      )
      expect(Exit.isFailure(result)).toBe(true)
    }),
  )

  // Disabled behavior
  disabledTest("list returns empty when evolution disabled", decisionsLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      const result = yield* svc.list()
      expect(result).toEqual([])
    }),
  )

  disabledTest("search returns empty when evolution disabled", decisionsLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionDecisions.Service
      const result = yield* svc.search("anything")
      expect(result).toEqual([])
    }),
  )
})

// ============================================================
// Project.Service
// ============================================================
describe("EvolutionProject", () => {
  instanceTest("profile returns project info", projectLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionProject.Service
      const profile = yield* svc.profile()
      expect(profile.root).toBeTruthy()
      expect(profile.name).toBeTruthy()
      expect(profile.vcs).toBe("git")
      expect(Array.isArray(profile.languages)).toBe(true)
      expect(Array.isArray(profile.frameworks)).toBe(true)
      expect(profile.structure).toMatch(/^(single|monorepo)$/)
    }),
  )

  instanceTest("detectFrameworks returns array", projectLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionProject.Service
      const frameworks = yield* svc.detectFrameworks()
      expect(Array.isArray(frameworks)).toBe(true)
    }),
  )

  instanceTest("getStructure returns single or monorepo", projectLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionProject.Service
      const structure = yield* svc.getStructure()
      expect(structure).toMatch(/^(single|monorepo)$/)
    }),
  )

  instanceTest("hasDependency returns boolean", projectLayer, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionProject.Service
      const has = yield* svc.hasDependency("nonexistent-dep-xyz")
      expect(typeof has).toBe("boolean")
    }),
  )

  disabledTest("profile returns placeholder when evolution disabled", projectLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* EvolutionProject.Service
      const profile = yield* svc.profile()
      expect(profile.vcs).toBe("unknown")
      expect(profile.languages).toEqual([])
      expect(profile.frameworks).toEqual([])
      expect(profile.hasDocker).toBe(false)
    }),
  )
})

// ============================================================
// Evolution.Service (Facade)
// ============================================================
describe("Evolution.Service", () => {
  instanceTest("status returns disabled state when memory/decisions empty", evolutionLayer, () =>
    Effect.gen(function* () {
      const svc = yield* Evolution.Service
      const s = yield* svc.status()
      expect(s.enabled).toBe(true)
      expect(s.mode).toBe("assist")
      expect(s.memory.count).toBe(0)
      expect(s.decisions.count).toBe(0)
    }),
  )

  instanceTest("getConfig returns evolution config", evolutionLayer, () =>
    Effect.gen(function* () {
      const svc = yield* Evolution.Service
      const cfg = yield* svc.getConfig()
      expect(cfg.enabled).toBe(true)
      expect(cfg.mode).toBe("assist")
    }),
  )

  instanceTest("getMemories bridges to Memory.Service", evolutionLayer, () =>
    Effect.gen(function* () {
      const memory = yield* EvolutionMemory.Service
      yield* memory.save({ type: "lesson", content: "facade test", tags: ["facade"] })
      const svc = yield* Evolution.Service
      const all = yield* svc.getMemories()
      expect(all.length).toBe(1)
      expect(all[0].content).toBe("facade test")
    }),
  )

  instanceTest("getDecisions bridges to Decision.Service", evolutionLayer, () =>
    Effect.gen(function* () {
      const decisions = yield* EvolutionDecisions.Service
      yield* decisions.save({ title: "Facade ADR", status: "accepted", context: "ctx", decision: "dec", consequences: "cons", tags: [] })
      const svc = yield* Evolution.Service
      const all = yield* svc.getDecisions()
      expect(all.length).toBe(1)
      expect(all[0].title).toBe("Facade ADR")
    }),
  )

  instanceTest("getProjectContext bridges to Project.Service", evolutionLayer, () =>
    Effect.gen(function* () {
      const svc = yield* Evolution.Service
      const profile = yield* svc.getProjectContext()
      expect(profile.root).toBeTruthy()
    }),
  )

  // Disabled facade
  disabledTest("status shows disabled when evolution off", evolutionLayerDisabled, () =>
    Effect.gen(function* () {
      const svc = yield* Evolution.Service
      const s = yield* svc.status()
      expect(s.enabled).toBe(false)
      expect(s.mode).toBe("observe")
    }),
  )
})
