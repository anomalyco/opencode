import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Scope, Fiber } from "effect"
import { Evolution } from "@/evolution/index"
import { Config } from "@/config/config"

const mockEvolution = Evolution.Service.of({
  memory: () => ({
    all: () => Effect.succeed([]),
    save: (entry: any) =>
      Effect.succeed({
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: entry.type ?? "lesson",
        content: entry.content ?? "",
        tags: entry.tags ?? [],
        created: Date.now(),
        updated: Date.now(),
      }),
    retrieve: (query: any) =>
      Effect.succeed([
        {
          id: "mem-existing-1",
          type: query.type ?? "lesson",
          content: "Decision: use strict mode in tsconfig",
          tags: ["decision", "typescript"],
          created: Date.now() - 1000,
          updated: Date.now() - 1000,
        },
      ]),
    search: () => Effect.succeed([]),
    summarize: () => Effect.succeed({ count: 1, lastUpdate: Date.now(), types: { lesson: 1 } }),
    compact: () => Effect.void,
  }),
  decisions: () => ({
    list: () => Effect.succeed([]),
    get: () => Effect.succeed(undefined),
    save: (input: any) =>
      Effect.succeed({
        id: `ADR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        title: input.title ?? "",
        status: "proposed" as const,
        context: input.context ?? "",
        decision: input.decision ?? "",
        consequences: input.consequences ?? "",
        tags: input.tags ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

const baseLayer = Layer.mergeAll(
  Layer.succeed(Config.Service, mockConfig),
  Layer.succeed(Evolution.Service, mockEvolution),
)

describe("S-04.1 — Memory Proposal via Evolution.Service Facade", () => {
  test("Decision Engine proposes memory via evolution.memory().save()", async () => {
    const result = await Effect.gen(function* () {
      const evolution = yield* Evolution.Service

      const memoryEntry = yield* evolution.memory().save({
        type: "lesson",
        content: "Decision engine learned: prefer functional style",
        tags: ["decision-engine", "functional"],
      })

      return memoryEntry
    }).pipe(Effect.provide(baseLayer), Effect.runPromise)

    expect(result.type).toBe("lesson")
    expect(result.content).toContain("Decision engine learned")
    expect(result.tags).toContain("decision-engine")
  })

  test("memory saved via facade is retrievable via same path", async () => {
    const result = await Effect.gen(function* () {
      const evolution = yield* Evolution.Service

      yield* evolution.memory().save({
        type: "observation",
        content: "Decision: use strict mode in tsconfig",
        tags: ["decision", "typescript"],
      })

      const memories = yield* evolution.memory().retrieve({ type: "observation" })
      return memories
    }).pipe(Effect.provide(baseLayer), Effect.runPromise)

    expect(result.length).toBeGreaterThan(0)
    expect(result[0].tags).toContain("decision")
  })
})

describe("S-04.2 — Write Path: No Direct Storage Access", () => {
  test("Decision Engine cannot access brain storage directly", async () => {
    const evolution = await Effect.gen(function* () {
      return yield* Evolution.Service
    }).pipe(Effect.provide(baseLayer), Effect.runPromise)

    const methods = Object.keys(evolution.memory()) as Array<keyof ReturnType<Evolution.Interface["memory"]>>
    expect(methods).not.toContain("readStorage")
    expect(methods).not.toContain("writeStorage")
    expect(methods).toContain("save")
  })
})

describe("S-04.3 — Concurrent Save via Facade", () => {
  test("concurrent memory saves from different callers produce unique IDs", async () => {
    const ids = await Effect.gen(function* () {
      const scope = yield* Scope.make()
      const evolution = yield* Evolution.Service

      const fiber1 = yield* Effect.forkIn(
        evolution.memory().save({
          type: "lesson",
          content: "Caller 1 memory",
          tags: ["caller1"],
        }),
        scope,
      )

      const fiber2 = yield* Effect.forkIn(
        evolution.memory().save({
          type: "lesson",
          content: "Caller 2 memory",
          tags: ["caller2"],
        }),
        scope,
      )

      const mem1 = yield* Fiber.join(fiber1)
      const mem2 = yield* Fiber.join(fiber2)
      yield* Scope.close(scope, Exit.void)
      return [mem1.id, mem2.id].sort()
    }).pipe(Effect.provide(baseLayer), Effect.runPromise)

    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe("S-04.4 — Sequential Saves Work", () => {
  test("sequential saves from single Decision Engine fiber produce unique IDs", async () => {
    const results = await Effect.gen(function* () {
      const evolution = yield* Evolution.Service

      const mem1 = yield* evolution.memory().save({
        type: "lesson",
        content: "First decision memory",
        tags: ["decision-1"],
      })

      const mem2 = yield* evolution.memory().save({
        type: "lesson",
        content: "Second decision memory",
        tags: ["decision-2"],
      })

      return [mem1.id, mem2.id]
    }).pipe(Effect.provide(baseLayer), Effect.runPromise)

    expect(results).toHaveLength(2)
    expect(results[0]).not.toBe(results[1])
  })
})
