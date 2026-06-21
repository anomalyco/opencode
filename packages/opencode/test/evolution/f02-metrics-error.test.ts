import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Evolution } from "../../src/evolution/index"
import { MetricsService } from "../../src/evolution/evolution/metrics"
import { EvolutionStorageError } from "../../src/evolution/error"

describe("F-02 — Metrics Error Propagation", () => {
  test("snapshot propagates EvolutionStorageError from listProposals", async () => {
    const mock = Evolution.Service.of({
      memory: () => ({} as any),
      decisions: () => ({
        listProposals: () => Effect.fail(new EvolutionStorageError({ message: "storage error", operation: "read", path: "proposals" })),
        getReconciliationLogs: () => Effect.succeed([]),
        list: () => Effect.succeed([]),
        get: () => Effect.succeed(undefined),
        save: () => Effect.succeed({} as any),
        search: () => Effect.succeed([]),
        summarize: () => Effect.succeed({ count: 0, byStatus: {} }),
        supersede: () => Effect.succeed({} as any),
        propose: () => Effect.succeed({} as any),
        submit: () => Effect.succeed({} as any),
        decisionRecord: () => Effect.succeed([]),
        saveReconciliationLog: () => Effect.void,
        gc: () => Effect.succeed(0),
        getStorageStats: () => Effect.succeed({ proposalCount: 0, proposalBytes: 0, reconcilCount: 0, reconcilBytes: 0 }),
      }),
      project: () => ({} as any),
      status: () => Effect.succeed({} as any),
      getConfig: () => Effect.succeed({}),
      getMemories: () => Effect.succeed([]),
      getDecisions: () => Effect.succeed([]),
      getProjectContext: () => Effect.succeed({} as any),
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
    const mock = Evolution.Service.of({
      memory: () => ({} as any),
      decisions: () => ({
        listProposals: () => Effect.succeed([]),
        getReconciliationLogs: () => Effect.fail(new EvolutionStorageError({ message: "storage error", operation: "read", path: "reconciliation" })),
        list: () => Effect.succeed([]),
        get: () => Effect.succeed(undefined),
        save: () => Effect.succeed({} as any),
        search: () => Effect.succeed([]),
        summarize: () => Effect.succeed({ count: 0, byStatus: {} }),
        supersede: () => Effect.succeed({} as any),
        propose: () => Effect.succeed({} as any),
        submit: () => Effect.succeed({} as any),
        decisionRecord: () => Effect.succeed([]),
        saveReconciliationLog: () => Effect.void,
        gc: () => Effect.succeed(0),
        getStorageStats: () => Effect.succeed({ proposalCount: 0, proposalBytes: 0, reconcilCount: 0, reconcilBytes: 0 }),
      }),
      project: () => ({} as any),
      status: () => Effect.succeed({} as any),
      getConfig: () => Effect.succeed({}),
      getMemories: () => Effect.succeed([]),
      getDecisions: () => Effect.succeed([]),
      getProjectContext: () => Effect.succeed({} as any),
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
    const mock = Evolution.Service.of({
      memory: () => ({} as any),
      decisions: () => ({
        listProposals: () => Effect.succeed([]),
        getReconciliationLogs: () => Effect.succeed([]),
        list: () => Effect.succeed([]),
        get: () => Effect.succeed(undefined),
        save: () => Effect.succeed({} as any),
        search: () => Effect.succeed([]),
        summarize: () => Effect.succeed({ count: 0, byStatus: {} }),
        supersede: () => Effect.succeed({} as any),
        propose: () => Effect.succeed({} as any),
        submit: () => Effect.succeed({} as any),
        decisionRecord: () => Effect.succeed([]),
        saveReconciliationLog: () => Effect.void,
        gc: () => Effect.succeed(0),
        getStorageStats: () => Effect.succeed({ proposalCount: 0, proposalBytes: 0, reconcilCount: 0, reconcilBytes: 0 }),
      }),
      project: () => ({} as any),
      status: () => Effect.succeed({} as any),
      getConfig: () => Effect.succeed({}),
      getMemories: () => Effect.succeed([]),
      getDecisions: () => Effect.succeed([]),
      getProjectContext: () => Effect.succeed({} as any),
    })

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
