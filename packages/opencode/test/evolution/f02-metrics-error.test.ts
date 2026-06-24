import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Evolution } from "../../src/evolution/index"
import { MetricsService } from "../../src/evolution/evolution/metrics"
import { EvolutionStorageError } from "../../src/evolution/error"
import { mockMemory, mockProject, mockDecisions, projProfile } from "./fixture/mock-evolution"

function mockStatus(): Evolution.Status {
  return { enabled: false, mode: "observe", memory: { count: 0, lastUpdate: null }, decisions: { count: 0 }, project: { detected: false, root: "", frameworks: [] } }
}

function makeMock(decisionsOverrides: Partial<ReturnType<typeof mockDecisions>>) {
  return Evolution.Service.of({
    memory: () => mockMemory(),
    decisions: () => ({ ...mockDecisions(), ...decisionsOverrides }),
    project: () => mockProject(),
    status: () => Effect.succeed(mockStatus()),
    getConfig: () => Effect.succeed({}),
    getMemories: () => Effect.succeed([]),
    getDecisions: () => Effect.succeed([]),
    getProjectContext: () => Effect.succeed(projProfile()),
  })
}

describe("F-02 — Metrics Error Propagation", () => {
  test("snapshot propagates EvolutionStorageError from listProposals", async () => {
    const mock = makeMock({
      listProposals: () => Effect.fail(new EvolutionStorageError({ message: "storage error", operation: "read", path: "proposals" })),
    })

    const testLayer = Layer.provideMerge(
      MetricsService.layer,
      Layer.succeed(Evolution.Service, mock),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MetricsService.Service
        return yield* svc.snapshot()
      }).pipe(Effect.provide(testLayer), Effect.flip),
    )

    expect(result).toBeInstanceOf(EvolutionStorageError)
    expect((result as EvolutionStorageError).operation).toBe("read")
  })

  test("snapshot propagates EvolutionStorageError from getReconciliationLogs", async () => {
    const mock = makeMock({
      getReconciliationLogs: () => Effect.fail(new EvolutionStorageError({ message: "storage error", operation: "read", path: "reconciliation" })),
    })

    const testLayer = Layer.provideMerge(
      MetricsService.layer,
      Layer.succeed(Evolution.Service, mock),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MetricsService.Service
        return yield* svc.snapshot()
      }).pipe(Effect.provide(testLayer), Effect.flip),
    )

    expect(result).toBeInstanceOf(EvolutionStorageError)
    expect((result as EvolutionStorageError).operation).toBe("read")
  })

  test("snapshot succeeds when both read paths work", async () => {
    const mock = makeMock({})

    const testLayer = Layer.provideMerge(
      MetricsService.layer,
      Layer.succeed(Evolution.Service, mock),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MetricsService.Service
        return yield* svc.snapshot()
      }).pipe(Effect.provide(testLayer)),
    )

    expect(result).toBeDefined()
    expect(result.totalProposals).toBeNull()
    expect(result.totalReconciliations).toBeNull()
  })
})
