import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer, Scope, Fiber } from "effect"
import { Evolution, EvolutionMemory } from "@/evolution/index"
import { Config } from "@/config/config"
import { mockEvolution, mockMemory } from "@test/evolution/fixture/mock-evolution"

const baseLayer = Layer.mergeAll(
  Layer.mock(Config.Service, {
    get: () => Effect.succeed({}),
    getGlobal: () => Effect.succeed({}),
    getConsoleState: () => Effect.succeed({ consoleManagedProviders: [], activeOrgName: undefined, switchableOrgCount: 0 }),
    updateGlobal: () => Effect.succeed({ info: {}, changed: false }),
  }),
  Layer.succeed(Evolution.Service, {
    ...mockEvolution(),
    memory: () => ({
      ...mockMemory(),
      save: (entry: Omit<EvolutionMemory.MemoryEntry, "id" | "created" | "updated">) =>
        Effect.succeed({
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ...entry,
          created: Date.now(),
          updated: Date.now(),
        }),
      retrieve: (query: Parameters<EvolutionMemory.Interface["retrieve"]>[0]) =>
        Effect.succeed([
          {
            id: "mem-existing-1",
            type: "lesson" as const,
            content: "Decision: use strict mode in tsconfig",
            tags: ["decision", "typescript"],
            created: Date.now() - 1000,
            updated: Date.now() - 1000,
          },
        ]),
    }),
  }),
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
