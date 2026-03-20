import { describe, expect, test, beforeEach } from "bun:test"
import { Metrics } from "../../src/parallel/metrics"
import { PlanID, SubtaskID } from "../../src/parallel/schema"

describe("Metrics", () => {
  beforeEach(() => {
    Metrics.reset()
  })

  describe("Counter increments", () => {
    test("spawn attempt counter increments correctly", () => {
      expect(Metrics.getMetrics().spawnAttempts).toBe(0)

      Metrics.recordSpawnAttempt()
      expect(Metrics.getMetrics().spawnAttempts).toBe(1)

      Metrics.recordSpawnAttempt()
      Metrics.recordSpawnAttempt()
      expect(Metrics.getMetrics().spawnAttempts).toBe(3)
    })

    test("spawn success counter increments correctly", () => {
      expect(Metrics.getMetrics().spawnSuccess).toBe(0)

      Metrics.recordSpawnSuccess()
      expect(Metrics.getMetrics().spawnSuccess).toBe(1)

      Metrics.recordSpawnSuccess()
      expect(Metrics.getMetrics().spawnSuccess).toBe(2)
    })

    test("spawn failure counter increments correctly", () => {
      expect(Metrics.getMetrics().spawnFailure).toBe(0)

      Metrics.recordSpawnFailure()
      expect(Metrics.getMetrics().spawnFailure).toBe(1)

      Metrics.recordSpawnFailure()
      Metrics.recordSpawnFailure()
      expect(Metrics.getMetrics().spawnFailure).toBe(3)
    })

    test("timeout counter increments correctly", () => {
      expect(Metrics.getMetrics().timeoutCount).toBe(0)

      Metrics.recordTimeout(PlanID.make("plan-1"), SubtaskID.make("subtask-1"))
      expect(Metrics.getMetrics().timeoutCount).toBe(1)

      Metrics.recordTimeout(PlanID.make("plan-2"), SubtaskID.make("subtask-2"))
      expect(Metrics.getMetrics().timeoutCount).toBe(2)
    })

    test("plan outcome counters increment correctly", () => {
      expect(Metrics.getMetrics().planDone).toBe(0)
      expect(Metrics.getMetrics().planPartial).toBe(0)
      expect(Metrics.getMetrics().planFailed).toBe(0)

      Metrics.recordPlanOutcome("done")
      expect(Metrics.getMetrics().planDone).toBe(1)

      Metrics.recordPlanOutcome("partial_success")
      expect(Metrics.getMetrics().planPartial).toBe(1)

      Metrics.recordPlanOutcome("failed")
      expect(Metrics.getMetrics().planFailed).toBe(1)

      Metrics.recordPlanOutcome("done")
      Metrics.recordPlanOutcome("done")
      expect(Metrics.getMetrics().planDone).toBe(3)
    })
  })

  describe("Average calculation", () => {
    test("worker startup duration average calculates correctly", () => {
      const metrics = Metrics.getMetrics()
      expect(metrics.workerStartupDuration.count).toBe(0)
      expect(metrics.workerStartupDuration.average).toBe(0)

      Metrics.recordWorkerStartup(100)
      const metrics1 = Metrics.getMetrics()
      expect(metrics1.workerStartupDuration.count).toBe(1)
      expect(metrics1.workerStartupDuration.average).toBe(100)

      Metrics.recordWorkerStartup(200)
      const metrics2 = Metrics.getMetrics()
      expect(metrics2.workerStartupDuration.count).toBe(2)
      expect(metrics2.workerStartupDuration.average).toBe(150)

      Metrics.recordWorkerStartup(300)
      const metrics3 = Metrics.getMetrics()
      expect(metrics3.workerStartupDuration.count).toBe(3)
      expect(metrics3.workerStartupDuration.average).toBe(200)
    })

    test("average is zero when no samples", () => {
      const metrics = Metrics.getMetrics()
      expect(metrics.workerStartupDuration.average).toBe(0)
    })

    test("average handles single sample correctly", () => {
      Metrics.recordWorkerStartup(500)
      const metrics = Metrics.getMetrics()
      expect(metrics.workerStartupDuration.average).toBe(500)
    })
  })

  describe("getMetrics snapshot", () => {
    test("returns correct snapshot with all counters", () => {
      Metrics.recordSpawnAttempt()
      Metrics.recordSpawnSuccess()
      Metrics.recordWorkerStartup(100)
      Metrics.recordPlanOutcome("done")
      Metrics.recordTimeout(PlanID.make("plan-1"), SubtaskID.make("subtask-1"))

      const metrics = Metrics.getMetrics()

      expect(metrics.spawnAttempts).toBe(1)
      expect(metrics.spawnSuccess).toBe(1)
      expect(metrics.spawnFailure).toBe(0)
      expect(metrics.timeoutCount).toBe(1)
      expect(metrics.planDone).toBe(1)
      expect(metrics.planPartial).toBe(0)
      expect(metrics.planFailed).toBe(0)
      expect(metrics.workerStartupDuration.count).toBe(1)
      expect(metrics.workerStartupDuration.average).toBe(100)
    })

    test("snapshot is isolated from subsequent changes", () => {
      Metrics.recordSpawnAttempt()
      const snapshot = Metrics.getMetrics()

      Metrics.recordSpawnAttempt()
      const newMetrics = Metrics.getMetrics()

      expect(snapshot.spawnAttempts).toBe(1)
      expect(newMetrics.spawnAttempts).toBe(2)
    })
  })

  describe("reset", () => {
    test("clears all counters", () => {
      Metrics.recordSpawnAttempt()
      Metrics.recordSpawnSuccess()
      Metrics.recordSpawnFailure()
      Metrics.recordTimeout(PlanID.make("plan-1"), SubtaskID.make("subtask-1"))
      Metrics.recordPlanOutcome("done")
      Metrics.recordPlanOutcome("partial_success")
      Metrics.recordPlanOutcome("failed")
      Metrics.recordWorkerStartup(100)

      Metrics.reset()

      const metrics = Metrics.getMetrics()
      expect(metrics.spawnAttempts).toBe(0)
      expect(metrics.spawnSuccess).toBe(0)
      expect(metrics.spawnFailure).toBe(0)
      expect(metrics.timeoutCount).toBe(0)
      expect(metrics.planDone).toBe(0)
      expect(metrics.planPartial).toBe(0)
      expect(metrics.planFailed).toBe(0)
      expect(metrics.workerStartupDuration.count).toBe(0)
      expect(metrics.workerStartupDuration.average).toBe(0)
    })

    test("allows counters to be incremented after reset", () => {
      Metrics.recordSpawnAttempt()
      Metrics.reset()
      Metrics.recordSpawnAttempt()

      expect(Metrics.getMetrics().spawnAttempts).toBe(1)
    })
  })
})
