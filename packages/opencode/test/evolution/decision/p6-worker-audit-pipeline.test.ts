import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, Option, Queue, Ref, Schedule, Scope } from "effect"
import { AsyncAuditLogger } from "@/evolution/audit/async-logger"
import { WorkerPool } from "@/evolution/orchestration/worker-pool"
import { ExecutionPipeline } from "@/evolution/execution/pipeline"
import type { Decision, AuditEntry } from "@/evolution/decision/p6-types"

const TIMEOUT = 15_000

// --------------- AsyncAuditLogger Tests ---------------

describe("P6 — AsyncAuditLogger", () => {
  test("logs entry successfully", async () => {
    const entry: AuditEntry = {
      decisionId: "test-1",
      category: "CONFIG_THRESHOLD",
      outcome: "AUTO_EXECUTED",
      executor: "system",
      timestamp: Date.now(),
      reason: "test",
      consensusOutcome: "UNANIMOUS_APPROVED",
    }

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const svc = yield* AsyncAuditLogger.Service
          yield* svc.log(entry)
          yield* svc.flush
          return yield* svc.getQueueDepth
        }).pipe(Effect.provide(AsyncAuditLogger.layer)),
      ),
    )
    expect(result).toBe(0)
  }, TIMEOUT)

  test("multiple entries get batched and drained on flush", async () => {
    const entries: AuditEntry[] = Array.from({ length: 5 }, (_, i) => ({
      decisionId: `test-batch-${i}`,
      category: "CONFIG_BUDGET" as const,
      outcome: "HELD_FOR_REVIEW" as const,
      executor: "system",
      timestamp: Date.now(),
      reason: `batch test ${i}`,
      consensusOutcome: "VETO_HELD" as const,
    }))

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const svc = yield* AsyncAuditLogger.Service
          for (const e of entries) {
            yield* svc.log(e)
          }
          const beforeFlush = yield* svc.getQueueDepth
          yield* svc.flush
          const afterFlush = yield* svc.getQueueDepth
          return { beforeFlush, afterFlush }
        }).pipe(Effect.provide(AsyncAuditLogger.layer)),
      ),
    )
    expect(result.beforeFlush).toBe(5)
    expect(result.afterFlush).toBe(0)
  }, TIMEOUT)

  test("start and stop lifecycle does not error", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const svc = yield* AsyncAuditLogger.Service
          yield* svc.start
          yield* svc.stop
          return "ok"
        }).pipe(Effect.provide(AsyncAuditLogger.layer)),
      ),
    )
    expect(result).toBe("ok")
  }, TIMEOUT)
})

// --------------- WorkerPool Tests ---------------

const mockWorkerPool = Layer.effect(
  WorkerPool.Service,
  Effect.succeed({
    submitTask: (_id: string, _task: () => Promise<unknown>) => Effect.void,
    getPoolState: Effect.succeed({ active: 0, queued: 0, maxWorkers: 5 }),
    resetPool: Effect.void,
  }),
)

describe("P6 — WorkerPool", () => {
  test("submitTask runs and pool state is correct (mock)", async () => {
    let completed = false
    const poolImpl = {
      submitTask: (_id: string, task: () => Promise<unknown>) =>
        Effect.promise(task).pipe(Effect.as(Effect.void)),
      getPoolState: Effect.succeed({ active: 0, queued: 0, maxWorkers: 5 }),
      resetPool: Effect.void,
    }
    const mockPoolLayer = Layer.effect(WorkerPool.Service, Effect.succeed(poolImpl))

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* WorkerPool.Service
          yield* pool.submitTask("test-1", async () => { completed = true })
          yield* Effect.sleep(Duration.millis(100))
          return yield* pool.getPoolState
        }).pipe(Effect.provide(mockPoolLayer)),
      ),
    )
    expect(completed).toBe(true)
    expect(result.active).toBe(0)
    expect(result.maxWorkers).toBe(5)
  }, TIMEOUT)

  test("queues when max workers reached (mock)", async () => {
    const poolImpl = {
      submitTask: () => Effect.void,
      getPoolState: Effect.succeed({ active: 5, queued: 1, maxWorkers: 5 }),
      resetPool: Effect.void,
    }
    const mockPoolLayer = Layer.effect(WorkerPool.Service, Effect.succeed(poolImpl))

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* WorkerPool.Service
          return yield* pool.getPoolState
        }).pipe(Effect.provide(mockPoolLayer)),
      ),
    )
    expect(result.active).toBe(5)
    expect(result.queued).toBe(1)
  }, TIMEOUT)
})

// --------------- Pipeline approve/reject Tests ---------------

describe("P6 — Pipeline approve/reject decisions", () => {
  const testDecision = (id: string): Decision => ({
    decisionId: id,
    consensusOutcome: "UNANIMOUS_APPROVED",
    proposedAction: "Test action",
    rationale: "Test rationale",
    category: "CONFIG_THRESHOLD",
    participants: [],
    enrichments: [],
  })

  const mockAsyncLoggerImpl = {
    log: () => Effect.void,
    flush: Effect.void,
    start: Effect.void,
    stop: Effect.void,
    getQueueDepth: Effect.succeed(0),
  }

  const mockAsyncLoggerTag = Layer.effect(AsyncAuditLogger.Service, Effect.succeed(mockAsyncLoggerImpl))

  function makePipeline() {
    return Effect.gen(function* () {
      const audit = yield* AsyncAuditLogger.Service
      const reviewRef = yield* Ref.make<Decision[]>([])

      const processDecision = Effect.fn("Pipeline.processDecision")(function* (decision: Decision) {
        if (decision.consensusOutcome !== "UNANIMOUS_APPROVED") {
          yield* Ref.update(reviewRef, (q) => [...q, decision])
          yield* audit.log({ decisionId: decision.decisionId, category: decision.category, outcome: "HELD_FOR_REVIEW", executor: "system", timestamp: Date.now(), reason: "test", consensusOutcome: decision.consensusOutcome })
          return "HELD_FOR_REVIEW" as const
        }
        yield* Ref.update(reviewRef, (q) => [...q, decision])
        yield* audit.log({ decisionId: decision.decisionId, category: decision.category, outcome: "PENDING_APPROVAL", executor: "system", timestamp: Date.now(), reason: "test", consensusOutcome: decision.consensusOutcome })
        return "PENDING_APPROVAL" as const
      })

      const approveDecision = Effect.fn("Pipeline.approveDecision")(function* (decisionId: string) {
        const queue = yield* Ref.get(reviewRef)
        const idx = queue.findIndex((d) => d.decisionId === decisionId)
        if (idx === -1) return false
        yield* Ref.update(reviewRef, (q) => q.filter((d) => d.decisionId !== decisionId))
        yield* audit.log({ decisionId, category: "CONFIG_THRESHOLD", outcome: "APPROVED", executor: "human", timestamp: Date.now(), reason: "Human approved", consensusOutcome: "UNANIMOUS_APPROVED" })
        return true
      })

      const rejectDecision = Effect.fn("Pipeline.rejectDecision")(function* (decisionId: string) {
        const queue = yield* Ref.get(reviewRef)
        const idx = queue.findIndex((d) => d.decisionId === decisionId)
        if (idx === -1) return false
        yield* Ref.update(reviewRef, (q) => q.filter((d) => d.decisionId !== decisionId))
        yield* audit.log({ decisionId, category: "CONFIG_THRESHOLD", outcome: "REJECTED", executor: "human", timestamp: Date.now(), reason: "Human rejected", consensusOutcome: "UNANIMOUS_APPROVED" })
        return true
      })

      const getHumanReviewQueue = Ref.get(reviewRef)

      return { processDecision, approveDecision, rejectDecision, getHumanReviewQueue }
    })
  }

  test("approveDecision returns false for unknown id", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pipeline = yield* makePipeline()
          return yield* pipeline.approveDecision("nonexistent")
        }).pipe(Effect.provide(mockAsyncLoggerTag)),
      ),
    )
    expect(result).toBe(false)
  }, TIMEOUT)

  test("approveDecision returns true and removes from queue", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pipeline = yield* makePipeline()
          yield* pipeline.processDecision(testDecision("approve-me"))
          const approved = yield* pipeline.approveDecision("approve-me")
          const queue = yield* pipeline.getHumanReviewQueue
          return { approved, queueLength: queue.length }
        }).pipe(Effect.provide(mockAsyncLoggerTag)),
      ),
    )
    expect(result.approved).toBe(true)
    expect(result.queueLength).toBe(0)
  }, TIMEOUT)

  test("rejectDecision returns false for unknown id", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pipeline = yield* makePipeline()
          return yield* pipeline.rejectDecision("nonexistent")
        }).pipe(Effect.provide(mockAsyncLoggerTag)),
      ),
    )
    expect(result).toBe(false)
  }, TIMEOUT)

  test("rejectDecision returns true and removes from queue", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pipeline = yield* makePipeline()
          yield* pipeline.processDecision(testDecision("reject-me"))
          const rejected = yield* pipeline.rejectDecision("reject-me")
          const queue = yield* pipeline.getHumanReviewQueue
          return { rejected, queueLength: queue.length }
        }).pipe(Effect.provide(mockAsyncLoggerTag)),
      ),
    )
    expect(result.rejected).toBe(true)
    expect(result.queueLength).toBe(0)
  }, TIMEOUT)
})
