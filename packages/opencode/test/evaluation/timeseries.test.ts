import { describe, expect, test, beforeEach } from "bun:test"
import { TimeSeries } from "../../src/evaluation/timeseries"
import { Metric } from "../../src/evaluation/metric"
import type { Trace } from "../../src/trace"

const testIds: string[] = []

beforeEach(async () => {
  for (const id of testIds) {
    try {
      await Metric.remove(id).catch(() => {})
    } catch {}
  }
  testIds.length = 0
})

const createMockTrace = (overrides?: Partial<Trace.Complete>): Trace.Complete => ({
  id: `trace-${Date.now()}-${Math.random()}`,
  projectID: "test-project",
  session: {
    id: "test-session",
    projectID: "test-project",
    directory: "/test",
    title: "Test Session",
    version: "1.0.0",
    time: { created: Date.now(), updated: Date.now() },
  },
  messageCount: 3,
  agentName: "test-agent",
  modelConfig: {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
  },
  output: "Test output",
  toolCalls: [
    { id: "Read", status: "success", duration: 100 } as any,
    { id: "Edit", status: "success", duration: 200 } as any,
  ],
  summary: {
    duration: 1500,
    toolCallCount: 2,
    errorCount: 0,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 20, write: 0 } },
    cost: 0.02,
  },
  evaluationIDs: [],
  createdAt: Date.now(),
  ...overrides,
})

describe("TimeSeries", () => {
  describe("record and getDataPoints", () => {
    test("records and retrieves data points", async () => {
      const metric: Metric.Definition = {
        id: "ts-metric",
        name: "TS Metric",
        description: "Time series metric",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const trace = createMockTrace()
      await TimeSeries.record(metric.id, trace, { environment: "test" })

      const points = await TimeSeries.getDataPoints(metric.id)
      expect(points.length).toBeGreaterThan(0)

      const point = points.find((p) => p.traceID === trace.id)
      expect(point).toBeDefined()
      expect(point!.metricID).toBe(metric.id)
      expect(point!.tags?.["environment"]).toBe("test")
    })

    test("filters data points by time range", async () => {
      const metric: Metric.Definition = {
        id: "ts-range-metric",
        name: "Range Metric",
        description: "Test time range",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const now = Date.now()
      const trace1 = createMockTrace()
      const trace2 = createMockTrace()

      await TimeSeries.record(metric.id, trace1)
      await new Promise((resolve) => setTimeout(resolve, 10))
      await TimeSeries.record(metric.id, trace2)

      const allPoints = await TimeSeries.getDataPoints(metric.id)
      expect(allPoints.length).toBeGreaterThanOrEqual(2)

      const recentPoints = await TimeSeries.getDataPoints(metric.id, {
        since: now + 5,
      })
      expect(recentPoints.length).toBeLessThanOrEqual(allPoints.length)
    })

    test("filters data points by tags", async () => {
      const metric: Metric.Definition = {
        id: "ts-tag-metric",
        name: "Tag Metric",
        description: "Test tag filtering",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const trace1 = createMockTrace()
      const trace2 = createMockTrace()

      await TimeSeries.record(metric.id, trace1, { env: "prod" })
      await TimeSeries.record(metric.id, trace2, { env: "dev" })

      const prodPoints = await TimeSeries.getDataPoints(metric.id, {
        tags: { env: "prod" },
      })
      expect(prodPoints.every((p) => p.tags?.["env"] === "prod")).toBe(true)
    })
  })

  describe("getAggregates", () => {
    test("computes hourly aggregates", async () => {
      const metric: Metric.Definition = {
        id: "ts-agg-metric",
        name: "Aggregate Metric",
        description: "Test aggregation",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record multiple data points
      for (let i = 0; i < 5; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1500,
            toolCallCount: 2,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.01 + i * 0.01, // Varying costs
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      const aggregates = await TimeSeries.getAggregates(metric.id, {
        period: "hour",
      })

      expect(aggregates.length).toBeGreaterThan(0)
      const agg = aggregates[0]
      expect(agg.metricID).toBe(metric.id)
      expect(agg.period).toBe("hour")
      expect(agg.count).toBeGreaterThan(0)
      expect(agg.mean).toBeGreaterThan(0)
      expect(agg.min).toBeLessThanOrEqual(agg.max)
    })
  })

  describe("analyzeTrend", () => {
    test("detects improving trend", async () => {
      const metric: Metric.Definition = {
        id: "trend-improving-metric",
        name: "Improving Metric",
        description: "Metric that improves over time",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false, // Lower cost is better
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record traces with decreasing cost (improving)
      for (let i = 0; i < 10; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1500,
            toolCallCount: 2,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.10 - i * 0.005, // Cost decreasing
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      const analysis = await TimeSeries.analyzeTrend(metric.id, { days: 1 })

      expect(analysis.metricID).toBe(metric.id)
      expect(analysis.trend).toBe("improving")
      expect(analysis.slope).toBeLessThan(0) // Decreasing
      expect(analysis.dataPoints).toBe(10)
    })

    test("detects degrading trend", async () => {
      const metric: Metric.Definition = {
        id: "trend-degrading-metric",
        name: "Degrading Metric",
        description: "Metric that degrades over time",
        version: "1.0.0",
        category: "reliability",
        evaluator: { type: "heuristic", function: "toolErrorRate" },
        higherIsBetter: false, // Lower error rate is better
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record traces with increasing error rate (degrading)
      for (let i = 0; i < 10; i++) {
        const errorCount = i >= 5 ? 1 : 0 // Errors increase
        const trace = createMockTrace({
          toolCalls: [
            { id: "Read", status: errorCount > 0 ? "error" : "success", duration: 100 } as any,
            { id: "Edit", status: "success", duration: 200 } as any,
          ],
        })
        await TimeSeries.record(metric.id, trace)
      }

      const analysis = await TimeSeries.analyzeTrend(metric.id, { days: 1 })

      expect(analysis.metricID).toBe(metric.id)
      expect(analysis.trend).toBe("degrading")
      expect(analysis.dataPoints).toBe(10)
    })

    test("detects stable trend", async () => {
      const metric: Metric.Definition = {
        id: "trend-stable-metric",
        name: "Stable Metric",
        description: "Metric that stays stable",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record traces with consistent cost
      for (let i = 0; i < 10; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1500,
            toolCallCount: 2,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.02 + (Math.random() * 0.001), // Small variation
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      const analysis = await TimeSeries.analyzeTrend(metric.id, { days: 1 })

      expect(analysis.metricID).toBe(metric.id)
      expect(analysis.trend).toBe("stable")
      expect(analysis.trendStrength).toBeLessThan(0.3)
    })

    test("detects anomalies", async () => {
      const metric: Metric.Definition = {
        id: "trend-anomaly-metric",
        name: "Anomaly Metric",
        description: "Metric with anomalies",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record mostly stable traces with one outlier
      for (let i = 0; i < 10; i++) {
        const cost = i === 5 ? 0.50 : 0.02 // Spike at i=5
        const trace = createMockTrace({
          summary: {
            duration: 1500,
            toolCallCount: 2,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost,
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      const analysis = await TimeSeries.analyzeTrend(metric.id, {
        days: 1,
        anomalyThreshold: 2,
      })

      expect(analysis.anomalies.length).toBeGreaterThan(0)
      const anomaly = analysis.anomalies[0]
      expect(anomaly.value).toBeGreaterThan(0.1)
      expect(Math.abs(anomaly.deviationSigmas)).toBeGreaterThan(2)
    })
  })

  describe("detectAnomaly", () => {
    test("detects anomalous current value", async () => {
      const metric: Metric.Definition = {
        id: "anomaly-detect-metric",
        name: "Anomaly Detection Metric",
        description: "Test anomaly detection",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Record historical data with consistent values
      for (let i = 0; i < 5; i++) {
        const trace = createMockTrace({
          summary: {
            duration: 1500,
            toolCallCount: 2,
            errorCount: 0,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.02,
          },
        })
        await TimeSeries.record(metric.id, trace)
      }

      // Check normal value
      const normalResult = await TimeSeries.detectAnomaly(metric.id, 0.02)
      expect(normalResult.isAnomaly).toBe(false)

      // Check anomalous value
      const anomalousResult = await TimeSeries.detectAnomaly(metric.id, 0.50)
      expect(anomalousResult.isAnomaly).toBe(true)
      expect(Math.abs(anomalousResult.zScore)).toBeGreaterThan(3)
    })

    test("handles insufficient data", async () => {
      const metric: Metric.Definition = {
        id: "anomaly-nodata-metric",
        name: "No Data Metric",
        description: "Test with no data",
        version: "1.0.0",
        category: "cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        tags: [],
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const result = await TimeSeries.detectAnomaly(metric.id, 0.02)
      expect(result.isAnomaly).toBe(false)
      expect(result.zScore).toBe(0)
      expect(result.historicalStdDev).toBe(0)
    })
  })
})
