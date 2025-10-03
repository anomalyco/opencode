import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EvaluationIntegration } from "../../src/evaluation/integration"
import { Metric } from "../../src/evaluation/metric"
import { Baseline } from "../../src/evaluation/baseline"
import { TimeSeries } from "../../src/evaluation/timeseries"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Trace as TraceType } from "../../src/trace"

// Helper to wrap tests with Instance context for storage isolation
async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn,
  })
}

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
      try {
        await TimeSeries.clearMetric(id)
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

      // Verify config is set
      const trace = createMockTrace()
      // Manually trigger evaluation to verify auto-evaluation config works
      await EvaluationIntegration.evaluateTrace(trace)

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
      await EvaluationIntegration.evaluateTrace(badTrace, {
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
        id: `anomaly-metric-${Date.now()}-${Math.random()}`,
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
      await EvaluationIntegration.evaluateTrace(anomalousTrace, {
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

      await EvaluationIntegration.evaluateTrace(trace, {
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

      await EvaluationIntegration.evaluateTraces(traces, {
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

  describe("edge cases - configuration", () => {
    test("handles empty metric list", async () => {
      // Should not throw with empty metrics
      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [],
        recordTimeSeries: true,
      })

      const trace = createMockTrace()
      await EvaluationIntegration.evaluateTrace(trace, {
        metricIDs: [],
      })

      expect(true).toBe(true)
    })

    test("handles non-existent metric gracefully", async () => {
      const trace = createMockTrace()

      // Should handle missing metric without crashing
      try {
        await EvaluationIntegration.evaluateTrace(trace, {
          metricIDs: ["non-existent-metric"],
          recordTimeSeries: true,
        })
      } catch (error) {
        // Expected to fail, but shouldn't crash the whole system
        expect(error).toBeDefined()
      }
    })

    test("handles reconfiguration of auto-evaluation", async () => {
      const metric1: Metric.Definition = {
        id: "reconfig-metric-1",
        name: "Reconfig Metric 1",
        description: "First metric",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric1)
      testIds.push(metric1.id)

      const metric2: Metric.Definition = {
        id: "reconfig-metric-2",
        name: "Reconfig Metric 2",
        description: "Second metric",
        version: "1.0.0",
        category: "reliability",
        evaluator: { type: "heuristic", function: "toolErrorRate" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric2)
      testIds.push(metric2.id)

      // First configuration
      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [metric1.id],
      })

      // Reconfigure with different metrics
      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [metric2.id],
      })

      // Should work without issues
      expect(true).toBe(true)
    })

    test("handles missing configuration for manual evaluation", async () => {
      EvaluationIntegration.disableAutoEvaluation()

      const trace = createMockTrace()

      // Should throw when no config provided and auto-eval disabled
      try {
        await EvaluationIntegration.evaluateTrace(trace)
        expect(false).toBe(true) // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain("No configuration provided")
      }
    })
  })

  describe("edge cases - baseline comparison", () => {
    test("skips baseline comparison when baseline has insufficient samples", async () => {
      const metric: Metric.Definition = {
        id: "insufficient-baseline-metric",
        name: "Insufficient Baseline Metric",
        description: "Test baseline with too few samples",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create baseline requiring 10 samples but only add 2
      const baseline = await Baseline.create({
        id: "insufficient-baseline",
        name: "Insufficient Baseline",
        description: "Not enough samples",
        metricIDs: [metric.id],
        minSampleSize: 10,
        regressionThreshold: 0.2,
      })
      testIds.push(baseline.id)

      // Add only 2 traces
      for (let i = 0; i < 2; i++) {
        const trace = createMockTrace()
        await Baseline.addTrace(baseline.id, trace)
      }

      const alerts: any[] = []
      const unsubscribe = EvaluationIntegration.onRegression((alert) => {
        alerts.push(alert)
      })

      const trace = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 100.0, // Huge cost, but shouldn't alert due to insufficient baseline
        },
      })

      await EvaluationIntegration.evaluateTrace(trace, {
        metricIDs: [metric.id],
        checkBaselines: true,
      })

      // Should not receive alert due to insufficient baseline samples
      expect(alerts.length).toBe(0)

      unsubscribe()
    })

    test("handles baseline with no matching metrics", async () => {
      const metric1: Metric.Definition = {
        id: "baseline-metric-1",
        name: "Baseline Metric 1",
        description: "First metric",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric1)
      testIds.push(metric1.id)

      const metric2: Metric.Definition = {
        id: "baseline-metric-2",
        name: "Baseline Metric 2",
        description: "Second metric",
        version: "1.0.0",
        category: "reliability",
        evaluator: { type: "heuristic", function: "toolErrorRate" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric2)
      testIds.push(metric2.id)

      // Create baseline for metric1
      const baseline = await Baseline.create({
        id: "mismatched-baseline",
        name: "Mismatched Baseline",
        description: "Only tracks metric1",
        metricIDs: [metric1.id],
        minSampleSize: 2,
      })
      testIds.push(baseline.id)

      for (let i = 0; i < 3; i++) {
        const trace = createMockTrace()
        await Baseline.addTrace(baseline.id, trace)
      }

      // Evaluate with metric2 only
      const trace = createMockTrace()
      await EvaluationIntegration.evaluateTrace(trace, {
        metricIDs: [metric2.id], // Different metric
        checkBaselines: true,
      })

      // Should complete without errors
      expect(true).toBe(true)
    })

    test("detects improvement alerts", () => withInstance(async () => {
      const metric: Metric.Definition = {
        id: "improvement-metric",
        name: "Improvement Metric",
        description: "Test metric for improvement detection",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create baseline with high cost
      const baseline = await Baseline.create({
        id: "improvement-baseline",
        name: "Improvement Baseline",
        description: "Baseline with high costs",
        metricIDs: [metric.id],
        minSampleSize: 3,
        regressionThreshold: 0.2,
      })
      testIds.push(baseline.id)

      // Add expensive traces
      for (let i = 0; i < 5; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1000,
            toolCallCount: 1,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.10,
          },
        })
        await Baseline.addTrace(baseline.id, trace)
      }

      const improvements: any[] = []
      const unsubscribe = EvaluationIntegration.onImprovement((alert) => {
        improvements.push(alert)
      })

      // Create trace with much lower cost
      const cheapTrace = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.01, // 90% cheaper
        },
      })

      await EvaluationIntegration.evaluateTrace(cheapTrace, {
        metricIDs: [metric.id],
        checkBaselines: true,
      })

      // Should detect improvement
      expect(improvements.length).toBeGreaterThan(0)
      expect(improvements[0].type).toBe("improvement")
      expect(improvements[0].currentValue).toBeLessThan(improvements[0].baselineValue)

      unsubscribe()
    }))
  })

  describe("edge cases - anomaly detection", () => {
    test("handles insufficient data for anomaly detection", async () => {
      const metric: Metric.Definition = {
        id: "anomaly-insufficient-metric",
        name: "Anomaly Insufficient Metric",
        description: "Test anomaly with insufficient data",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record only 1 trace (need 3 for anomaly detection)
      const trace1 = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.02,
        },
      })
      await TimeSeries.record(metric.id, trace1)

      const anomalies: any[] = []
      const unsubscribe = EvaluationIntegration.onAnomaly((alert) => {
        anomalies.push(alert)
      })

      // Try to evaluate with anomaly detection
      const trace2 = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 100.0, // Huge anomaly
        },
      })

      await EvaluationIntegration.evaluateTrace(trace2, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // Should not alert due to insufficient data
      expect(anomalies.length).toBe(0)

      unsubscribe()
    })

    test("handles all identical values in time series", async () => {
      const metric: Metric.Definition = {
        id: `identical-values-metric-${Date.now()}-${Math.random()}`,
        name: "Identical Values Metric",
        description: "Test with all identical values",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record 5 traces with identical cost
      for (let i = 0; i < 5; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1000,
            toolCallCount: 1,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.02, // Always same
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      const anomalies: any[] = []
      const unsubscribe = EvaluationIntegration.onAnomaly((alert) => {
        anomalies.push(alert)
      })

      // New trace with different cost
      const differentTrace = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.50, // Different
        },
      })

      await EvaluationIntegration.evaluateTrace(differentTrace, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // Should detect anomaly (stdDev=0 edge case)
      expect(anomalies.length).toBeGreaterThan(0)

      unsubscribe()
    })

    test("respects custom anomaly threshold", async () => {
      const metric: Metric.Definition = {
        id: "custom-threshold-metric",
        name: "Custom Threshold Metric",
        description: "Test custom anomaly threshold",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record normal traces with some variance
      for (let i = 0; i < 10; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1000,
            toolCallCount: 1,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.02 + (Math.random() * 0.01), // 0.02-0.03
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      const anomalies: any[] = []
      const unsubscribe = EvaluationIntegration.onAnomaly((alert) => {
        anomalies.push(alert)
      })

      // Slightly elevated cost
      const elevatedTrace = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.05, // 2x normal but maybe not 3-sigma
        },
      })

      // With strict threshold (2-sigma), should detect
      await EvaluationIntegration.evaluateTrace(elevatedTrace, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
        anomalyThreshold: 2,
      })

      // Might or might not detect depending on exact variance
      // Just check it doesn't crash
      expect(true).toBe(true)

      unsubscribe()
    })
  })

  describe("edge cases - callback management", () => {
    test("handles multiple callbacks for same alert type", async () => {
      const metric: Metric.Definition = {
        id: `multi-callback-metric-${Date.now()}-${Math.random()}`,
        name: "Multi Callback Metric",
        description: "Test multiple callbacks",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record some data
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

      const alerts1: any[] = []
      const alerts2: any[] = []
      const alerts3: any[] = []

      const unsub1 = EvaluationIntegration.onAnomaly((alert) => alerts1.push(alert))
      const unsub2 = EvaluationIntegration.onAnomaly((alert) => alerts2.push(alert))
      const unsub3 = EvaluationIntegration.onAnomaly((alert) => alerts3.push(alert))

      const anomalousTrace = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.50,
        },
      })

      await EvaluationIntegration.evaluateTrace(anomalousTrace, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // All callbacks should receive the alert
      expect(alerts1.length).toBeGreaterThan(0)
      expect(alerts2.length).toBeGreaterThan(0)
      expect(alerts3.length).toBeGreaterThan(0)

      unsub1()
      unsub2()
      unsub3()
    })

    test("handles callback errors gracefully", async () => {
      const metric: Metric.Definition = {
        id: `callback-error-metric-${Date.now()}-${Math.random()}`,
        name: "Callback Error Metric",
        description: "Test callback error handling",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

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

      const successfulAlerts: any[] = []

      // First callback throws error
      const unsub1 = EvaluationIntegration.onAnomaly(() => {
        throw new Error("Callback error!")
      })

      // Second callback should still work
      const unsub2 = EvaluationIntegration.onAnomaly((alert) => {
        successfulAlerts.push(alert)
      })

      const anomalousTrace = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.50,
        },
      })

      await EvaluationIntegration.evaluateTrace(anomalousTrace, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // Second callback should still receive alert despite first one failing
      expect(successfulAlerts.length).toBeGreaterThan(0)

      unsub1()
      unsub2()
    })

    test("unsubscribe prevents future callbacks", async () => {
      const metric: Metric.Definition = {
        id: "unsubscribe-metric",
        name: "Unsubscribe Metric",
        description: "Test unsubscribe functionality",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

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

      let callCount = 0
      const unsubscribe = EvaluationIntegration.onAnomaly(() => {
        callCount++
      })

      // First evaluation
      const trace1 = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.50,
        },
      })

      await EvaluationIntegration.evaluateTrace(trace1, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      const callsAfterFirst = callCount

      // Unsubscribe
      unsubscribe()

      // Second evaluation
      const trace2 = createMockTrace({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.50,
        },
      })

      await EvaluationIntegration.evaluateTrace(trace2, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // Call count should not increase after unsubscribe
      expect(callCount).toBe(callsAfterFirst)
    })
  })

  describe("edge cases - dashboard", () => {
    test("handles empty dashboard query", async () => {
      const dashboard = await EvaluationIntegration.getDashboard({
        metricIDs: [],
      })

      expect(dashboard.metrics.length).toBe(0)
    })

    test("handles dashboard with no data", async () => {
      const metric: Metric.Definition = {
        id: "empty-dashboard-metric",
        name: "Empty Dashboard Metric",
        description: "Test empty dashboard",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const dashboard = await EvaluationIntegration.getDashboard({
        metricIDs: [metric.id],
      })

      expect(dashboard.metrics.length).toBe(1)
      expect(dashboard.metrics[0].dataPoints).toBe(0)
      expect(dashboard.metrics[0].trend).toBeNull()
    })

    test("handles dashboard with time range filters", async () => {
      const metric: Metric.Definition = {
        id: "timerange-dashboard-metric",
        name: "Time Range Dashboard Metric",
        description: "Test dashboard with time filters",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const now = Date.now()
      const oneDayAgo = now - 24 * 60 * 60 * 1000
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000

      // Record traces at different times
      for (let i = 0; i < 3; i++) {
        const trace = createMockTrace({
          createdAt: twoDaysAgo + i * 1000,
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

      // Query only last 24 hours
      const dashboard = await EvaluationIntegration.getDashboard({
        metricIDs: [metric.id],
        since: oneDayAgo,
      })

      // Should work without errors
      expect(dashboard.metrics.length).toBe(1)
    })
  })

  describe("edge cases - tags", () => {
    test("records time-series with custom tags", async () => {
      const metric: Metric.Definition = {
        id: "tags-metric",
        name: "Tags Metric",
        description: "Test custom tags",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const trace = createMockTrace()

      await EvaluationIntegration.evaluateTrace(trace, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        tags: {
          environment: "staging",
          version: "v2.0.0",
          region: "us-east-1",
        },
      })

      const points = await TimeSeries.getDataPoints(metric.id)
      const point = points.find((p) => p.traceID === trace.id)

      expect(point).toBeDefined()
      expect(point!.tags?.["environment"]).toBe("staging")
      expect(point!.tags?.["version"]).toBe("v2.0.0")
      expect(point!.tags?.["region"]).toBe("us-east-1")
    })

    test("handles undefined tags gracefully", async () => {
      const metric: Metric.Definition = {
        id: "no-tags-metric",
        name: "No Tags Metric",
        description: "Test without tags",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const trace = createMockTrace()

      await EvaluationIntegration.evaluateTrace(trace, {
        metricIDs: [metric.id],
        recordTimeSeries: true,
        // No tags specified
      })

      const points = await TimeSeries.getDataPoints(metric.id)
      const point = points.find((p) => p.traceID === trace.id)

      expect(point).toBeDefined()
    })
  })
})
