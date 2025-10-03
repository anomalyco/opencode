import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EvaluationIntegration } from "../../src/evaluation/integration"
import { Metric } from "../../src/evaluation/metric"
import { Baseline } from "../../src/evaluation/baseline"
import { TimeSeries } from "../../src/evaluation/timeseries"
import { Trace } from "../../src/trace"
import type { Trace as TraceType } from "../../src/trace"

// Helper to create mock traces
function createMockTrace(overrides?: Partial<TraceType.Complete>): TraceType.Complete {
  return {
    id: `trace-${Date.now()}-${Math.random()}`,
    projectID: "test-project",
    session: {} as any,
    messageCount: 5,
    agentName: "test-agent",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Test output",
    toolCalls: [
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: Date.now(),
        duration: 100,
        status: "success",
      },
    ],
    summary: {
      duration: 1000,
      toolCallCount: 1,
      errorCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.01,
    },
    evaluationIDs: [],
    createdAt: Date.now(),
    completedAt: Date.now() + 1000,
    ...overrides,
  }
}

describe("EvaluationIntegration", () => {
  const testIds: string[] = []

  beforeEach(async () => {
    // Clean up any existing auto-evaluation
    EvaluationIntegration.disableAutoEvaluation()
  })

  afterEach(async () => {
    // Clean up
    EvaluationIntegration.disableAutoEvaluation()
    
    // Clean up test data
    for (const id of testIds) {
      try {
        await Metric.remove(id)
      } catch {}
      try {
        await Baseline.remove(id)
      } catch {}
    }
    testIds.length = 0
  })

  describe("enableAutoEvaluation", () => {
    test("enables automatic trace evaluation", async () => {
      const metric: Metric.Definition = {
        id: "auto-eval-metric",
        name: "Auto Eval Metric",
        description: "Test metric for auto-evaluation",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [metric.id],
        recordTimeSeries: true,
        checkBaselines: false,
      })

      // Simulate trace completion
      const trace = createMockTrace()
      await Trace.materialize(trace.session.id)

      // Give time for async processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Check that time-series was recorded
      const points = await TimeSeries.getDataPoints(metric.id)
      expect(points.length).toBeGreaterThan(0)
    })

    test("can be disabled", () => {
      EvaluationIntegration.disableAutoEvaluation()
      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe("alert callbacks", () => {
    test("onRegression receives regression alerts", async () => {
      const metric: Metric.Definition = {
        id: "regression-metric",
        name: "Regression Metric",
        description: "Test metric for regression detection",
        version: "1.0.0",
        category: "reliability",
        evaluator: { type: "heuristic", function: "toolErrorRate" },
        higherIsBetter: false,
        threshold: { pass: 0.1 },
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create baseline with good traces
      const baseline = await Baseline.create({
        id: "regression-baseline",
        name: "Regression Baseline",
        description: "Baseline for regression testing",
        metricIDs: [metric.id],
        minSampleSize: 2,
        regressionThreshold: 0.2,
      })
      testIds.push(baseline.id)

      // Add good traces to baseline
      for (let i = 0; i < 3; i++) {
        const trace = createMockTrace({
          toolCalls: [
            { id: "Read", status: "success", duration: 100 } as any,
            { id: "Edit", status: "success", duration: 200 } as any,
          ],
        })
        await Baseline.addTrace(baseline.id, trace)
      }

      // Set up alert listener
      const alerts: any[] = []
      const unsubscribe = EvaluationIntegration.onRegression((alert) => {
        alerts.push(alert)
      })

      // Enable auto-evaluation with baseline checking
      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [metric.id],
        recordTimeSeries: false,
        checkBaselines: true,
      })

      // Create trace with high error rate
      const badTrace = createMockTrace({
        toolCalls: [
          { id: "Read", status: "error", duration: 100 } as any,
          { id: "Edit", status: "error", duration: 200 } as any,
        ],
      })

      // Manually trigger evaluation (since we can't easily trigger Trace.Event.Completed)
      await EvaluationIntegration.evaluateTrace(badTrace.id, {
        metricIDs: [metric.id],
        checkBaselines: true,
      })

      // Should have received regression alert
      expect(alerts.length).toBeGreaterThan(0)
      expect(alerts[0].type).toBe("regression")
      expect(alerts[0].metricID).toBe(metric.id)

      unsubscribe()
    })

    test("onAnomaly receives anomaly alerts", async () => {
      const metric: Metric.Definition = {
        id: "anomaly-metric",
        name: "Anomaly Metric",
        description: "Test metric for anomaly detection",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record normal traces
      for (let i = 0; i < 5; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1000,
            toolCallCount: 1,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.02,
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      // Set up alert listener
      const alerts: any[] = []
      const unsubscribe = EvaluationIntegration.onAnomaly((alert) => {
        alerts.push(alert)
      })

      // Enable auto-evaluation with anomaly detection
      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // Create trace with anomalous cost
      const anomalousTrace = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.50, // Much higher than normal
        },
      })

      // Manually trigger evaluation
      await EvaluationIntegration.evaluateTrace(anomalousTrace.id, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // Should have received anomaly alert
      expect(alerts.length).toBeGreaterThan(0)
      expect(alerts[0].type).toBe("anomaly")
      expect(alerts[0].metricID).toBe(metric.id)

      unsubscribe()
    })
  })

  describe("getDashboard", () => {
    test("returns aggregated dashboard data", async () => {
      const metric: Metric.Definition = {
        id: "dashboard-metric",
        name: "Dashboard Metric",
        description: "Test metric for dashboard",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record some data points
      for (let i = 0; i < 10; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1000,
            toolCallCount: 1,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.01 + i * 0.001,
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      const dashboard = await EvaluationIntegration.getDashboard({
        metricIDs: [metric.id],
        period: "hour",
      })

      expect(dashboard.metrics.length).toBe(1)
      expect(dashboard.metrics[0].metric.id).toBe(metric.id)
      expect(dashboard.metrics[0].dataPoints).toBeGreaterThan(0)
    })
  })

  describe("manual evaluation", () => {
    test("evaluateTrace processes a single trace", async () => {
      const metric: Metric.Definition = {
        id: "manual-metric",
        name: "Manual Metric",
        description: "Test metric for manual evaluation",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const trace = createMockTrace()

      await EvaluationIntegration.evaluateTrace(trace.id, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
      })

      // Check that evaluation occurred
      const points = await TimeSeries.getDataPoints(metric.id)
      const tracePoint = points.find((p) => p.traceID === trace.id)
      expect(tracePoint).toBeDefined()
    })

    test("evaluateTraces processes multiple traces", async () => {
      const metric: Metric.Definition = {
        id: "batch-metric",
        name: "Batch Metric",
        description: "Test metric for batch evaluation",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const traces = [
        createMockTrace(),
        createMockTrace(),
        createMockTrace(),
      ]
      const traceIDs = traces.map((t) => t.id)

      await EvaluationIntegration.evaluateTraces(traceIDs, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
      })

      // Check that all traces were evaluated
      const points = await TimeSeries.getDataPoints(metric.id)
      for (const traceID of traceIDs) {
        const tracePoint = points.find((p) => p.traceID === traceID)
        expect(tracePoint).toBeDefined()
      }
    })
  })
})
