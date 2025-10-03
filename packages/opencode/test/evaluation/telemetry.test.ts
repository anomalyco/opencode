import { describe, test, expect, afterEach } from "bun:test"
import { Telemetry } from "../../src/evaluation/telemetry"
import { FeedbackManager } from "../../src/evaluation/feedback-manager"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { RealisticTraces } from "./fixtures/realistic-traces"

/**
 * Tests for telemetry collection and feedback management.
 */

// Helper to wrap tests with Instance context
async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn,
  })
}

describe("Telemetry", () => {
  const tracesToClean: string[] = []

  afterEach(async () => {
    for (const traceID of tracesToClean) {
      try {
        // Clean up telemetry and feedback
        const { Storage } = await import("../../src/storage/storage")
        await Storage.remove(["telemetry", traceID])
        await Storage.remove(["feedback", traceID])
      } catch {}
    }
    tracesToClean.length = 0
  })

  describe("Task Classification", () => {
    test("classifies simple edit tasks", () =>
      withInstance(async () => {
        const trace = RealisticTraces.quickFix()
        tracesToClean.push(trace.id)

        const metadata = await Telemetry.enrichTrace(trace)

        expect(metadata.taskClassification.type).toBe("edit")
        expect(metadata.taskClassification.complexity).toBe("simple")
        expect(metadata.taskClassification.confidence).toBeGreaterThan(0.5)
      }))

    test("classifies complex refactoring tasks", () =>
      withInstance(async () => {
        const trace = RealisticTraces.complexRefactoring()
        tracesToClean.push(trace.id)

        const metadata = await Telemetry.enrichTrace(trace)

        expect(metadata.taskClassification.type).toBe("refactor")
        expect(metadata.taskClassification.complexity).toBe("complex")
      }))

    test("classifies debug tasks with errors", () =>
      withInstance(async () => {
        const trace = RealisticTraces.failedWithRetry()
        tracesToClean.push(trace.id)

        const metadata = await Telemetry.enrichTrace(trace)

        // Should detect debugging pattern (execute + errors)
        expect(metadata.taskClassification.type).toBe("debug")
      }))

    test("enriches trace with timestamp", () =>
      withInstance(async () => {
        const trace = RealisticTraces.successfulCodeEdit()
        tracesToClean.push(trace.id)

        const metadata = await Telemetry.enrichTrace(trace)

        expect(metadata.traceID).toBe(trace.id)
        expect(metadata.timestamp).toBe(trace.createdAt)
        expect(metadata.collectedAt).toBeGreaterThan(0)
        expect(metadata.version).toBe("1.0.0")
      }))
  })

  describe("Outcome Proxies", () => {
    test("initializes with zero subsequent edits", () =>
      withInstance(async () => {
        const trace = RealisticTraces.successfulCodeEdit()
        tracesToClean.push(trace.id)

        const metadata = await Telemetry.enrichTrace(trace)

        expect(metadata.outcomeProxies.subsequentEdits).toBe(0)
        expect(metadata.outcomeProxies.subsequentEditWindow).toBe(60 * 60 * 1000)
      }))

    test("outcome proxies can be updated", () =>
      withInstance(async () => {
        const trace = RealisticTraces.successfulCodeEdit()
        tracesToClean.push(trace.id)

        const metadata = await Telemetry.enrichTrace(trace)

        // Simulate updating outcome after observing subsequent edits
        metadata.outcomeProxies.subsequentEdits = 3

        const { Storage } = await import("../../src/storage/storage")
        await Storage.write(["telemetry", trace.id], metadata)

        const retrieved = await Telemetry.getEnrichedMetadata(trace.id)
        expect(retrieved?.outcomeProxies.subsequentEdits).toBe(3)
      }))
  })

  describe("Telemetry Events", () => {
    test("emits enriched event when trace is enriched", () =>
      withInstance(async () => {
        const trace = RealisticTraces.successfulCodeEdit()
        tracesToClean.push(trace.id)

        let eventReceived = false
        const unsubscribe = Bus.subscribe(Telemetry.Event.Enriched, (event) => {
          if (event.properties.metadata.traceID === trace.id) {
            eventReceived = true
          }
        })

        await Telemetry.enrichTrace(trace)

        // Give event time to propagate
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(eventReceived).toBe(true)
        unsubscribe()
      }))
  })

  describe("User Feedback", () => {
    test("records and retrieves user feedback", () =>
      withInstance(async () => {
        const traceID = "test-trace-" + Date.now()
        tracesToClean.push(traceID)

        const feedback: Telemetry.UserFeedback = {
          traceID,
          timestamp: Date.now(),
          responses: {
            correctness: 5,
            speed: "fast",
            wouldUseAgain: true,
          },
          comment: "Excellent result!",
          requestedAt: Date.now() - 60000,
          respondedAt: Date.now(),
        }

        await Telemetry.recordFeedback(feedback)

        const retrieved = await Telemetry.getFeedback(traceID)
        expect(retrieved).not.toBeNull()
        expect(retrieved?.responses.correctness).toBe(5)
        expect(retrieved?.comment).toBe("Excellent result!")
      }))

    test("emits event when feedback is received", () =>
      withInstance(async () => {
        const traceID = "test-trace-" + Date.now()
        tracesToClean.push(traceID)

        let eventReceived = false
        const unsubscribe = Bus.subscribe(Telemetry.Event.FeedbackReceived, (event) => {
          if (event.properties.feedback.traceID === traceID) {
            eventReceived = true
          }
        })

        const feedback: Telemetry.UserFeedback = {
          traceID,
          timestamp: Date.now(),
          responses: {
            correctness: 4,
          },
          requestedAt: Date.now() - 5000,
          respondedAt: Date.now(),
        }

        await Telemetry.recordFeedback(feedback)

        // Give event time to propagate
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(eventReceived).toBe(true)
        unsubscribe()
      }))

    test("requests feedback with structured questions", () =>
      withInstance(async () => {
        const traceIDs = ["trace-1", "trace-2"]

        let requestReceived = false
        const unsubscribe = Bus.subscribe(Telemetry.Event.FeedbackRequested, (event) => {
          requestReceived = true
          expect(event.properties.request.traceIDs).toEqual(traceIDs)
          expect(event.properties.request.questions.length).toBeGreaterThan(0)
        })

        await Telemetry.requestFeedback(traceIDs)

        // Give event time to propagate
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(requestReceived).toBe(true)
        unsubscribe()
      }))
  })

  describe("Telemetry Query", () => {
    test("queries telemetry by time range", () =>
      withInstance(async () => {
        const trace1 = RealisticTraces.quickFix()
        trace1.createdAt = Date.now() - 10000
        tracesToClean.push(trace1.id)

        const trace2 = RealisticTraces.successfulCodeEdit()
        trace2.createdAt = Date.now() - 5000
        tracesToClean.push(trace2.id)

        await Telemetry.enrichTrace(trace1)
        await Telemetry.enrichTrace(trace2)

        const results = await Telemetry.query({
          since: Date.now() - 8000,
          limit: 10,
        })

        // Should only include trace2 (created after threshold)
        expect(results.some((r) => r.traceID === trace2.id)).toBe(true)
      }))

    test("queries telemetry by task type", () =>
      withInstance(async () => {
        const trace1 = RealisticTraces.quickFix() // edit task
        tracesToClean.push(trace1.id)

        const trace2 = RealisticTraces.complexRefactoring() // refactor task
        tracesToClean.push(trace2.id)

        await Telemetry.enrichTrace(trace1)
        await Telemetry.enrichTrace(trace2)

        const results = await Telemetry.query({
          taskType: "refactor",
          limit: 10,
        })

        expect(results.some((r) => r.traceID === trace2.id)).toBe(true)
        expect(results.every((r) => r.taskClassification.type === "refactor")).toBe(true)
      }))

    test("gets aggregated statistics", () =>
      withInstance(async () => {
        const trace1 = RealisticTraces.quickFix()
        tracesToClean.push(trace1.id)

        const trace2 = RealisticTraces.complexRefactoring()
        tracesToClean.push(trace2.id)

        await Telemetry.enrichTrace(trace1)
        await Telemetry.enrichTrace(trace2)

        const stats = await Telemetry.getStatistics()

        expect(stats.totalTraces).toBeGreaterThanOrEqual(2)
        expect(stats.byTaskType).toBeDefined()
        expect(stats.byComplexity).toBeDefined()
      }))
  })

  describe("Telemetry Cleanup", () => {
    test("cleans up old telemetry data", () =>
      withInstance(async () => {
        const trace = RealisticTraces.quickFix()
        trace.createdAt = Date.now() - 40 * 24 * 60 * 60 * 1000 // 40 days ago
        tracesToClean.push(trace.id)

        await Telemetry.enrichTrace(trace)

        // Clean up data older than 30 days
        const removed = await Telemetry.cleanup(30 * 24 * 60 * 60 * 1000)

        expect(removed).toBeGreaterThanOrEqual(1)

        // Verify it's actually removed
        const retrieved = await Telemetry.getEnrichedMetadata(trace.id)
        expect(retrieved).toBeNull()
      }))
  })
})

describe("FeedbackManager", () => {
  afterEach(() => {
    FeedbackManager.disable()
  })

  test("can be enabled and disabled", () =>
    withInstance(async () => {
      FeedbackManager.enable()
      // Should not throw
      FeedbackManager.disable()
      // Should be idempotent
      FeedbackManager.disable()
    }))

  test("accepts custom strategy", () =>
    withInstance(async () => {
      FeedbackManager.enable({
        minCostThreshold: 0.1,
        maxRequestsPerHour: 2,
      })
      // Should not throw
      FeedbackManager.disable()
    }))

  test("tracks feedback statistics", () =>
    withInstance(async () => {
      const stats = await FeedbackManager.getStatistics()

      expect(stats.totalRequested).toBeGreaterThanOrEqual(0)
      expect(stats.totalResponded).toBeGreaterThanOrEqual(0)
      expect(stats.responseRate).toBeGreaterThanOrEqual(0)
      expect(stats.avgResponseTime).toBeGreaterThanOrEqual(0)
    }))
})
