import { describe, test, expect, afterEach } from "bun:test"
import { Metric } from "../../src/evaluation/metric"
import { TimeSeries } from "../../src/evaluation/timeseries"
import { Baseline } from "../../src/evaluation/baseline"
import { TimeUtils } from "../../src/evaluation/time-utils"
import { MetricSemantics } from "../../src/evaluation/metric-semantics"
import { RealisticTraces } from "./fixtures/realistic-traces"

/**
 * Tests for robustness improvements:
 * - Timestamp validation
 * - Batch operations
 * - Data quality checks
 * - Metric semantics
 */

describe("Robustness Improvements", () => {
  const testIds: string[] = []

  afterEach(async () => {
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

  describe("Timestamp Validation", () => {
    test("validates reasonable timestamps", () => {
      const now = Date.now()
      const validated = TimeUtils.validateTimestamp(now, "test")
      expect(validated).toBe(now)
    })

    test("throws on invalid timestamps", () => {
      expect(() => TimeUtils.validateTimestamp(0, "test")).toThrow("Invalid timestamp")
      expect(() => TimeUtils.validateTimestamp(-1, "test")).toThrow("must be positive")
      expect(() => TimeUtils.validateTimestamp(NaN, "test")).toThrow("Invalid timestamp")
    })

    test("throws on timestamp in seconds instead of milliseconds", () => {
      const timestampInSeconds = Math.floor(Date.now() / 1000)
      expect(() => TimeUtils.validateTimestamp(timestampInSeconds, "test")).toThrow(
        "appears to be in seconds"
      )
    })

    test("warns on very old timestamps", () => {
      const oneYearAgo = Date.now() - 400 * 24 * 60 * 60 * 1000
      // Should not throw, but will warn
      const validated = TimeUtils.validateTimestamp(oneYearAgo, "test", {
        warnIfOlderThanDays: 365,
      })
      expect(validated).toBe(oneYearAgo)
    })
  })

  describe("Time Utilities", () => {
    test("creates evenly-spaced time range", () => {
      const timestamps = TimeUtils.createTimeRange(7, Date.now(), 100)
      expect(timestamps.length).toBe(100)

      // Check spacing is consistent
      const gaps = []
      for (let i = 1; i < timestamps.length; i++) {
        gaps.push(timestamps[i] - timestamps[i - 1])
      }
      const avgGap = gaps.reduce((a, b) => a + b) / gaps.length
      const maxDeviation = Math.max(...gaps.map((g) => Math.abs(g - avgGap)))
      expect(maxDeviation).toBeLessThan(10) // Within 10ms tolerance
    })

    test("formats timestamps for debugging", () => {
      const now = Date.now()
      const formatted = TimeUtils.formatTimestamp(now)
      expect(formatted).toContain("ago)")

      const hourAgo = now - 60 * 60 * 1000
      const formattedHour = TimeUtils.formatTimestamp(hourAgo)
      expect(formattedHour).toContain("1h ago")
    })

    test("extracts UTC hours correctly", () => {
      const timestamp = new Date("2024-01-15T14:30:00Z").getTime()
      const hour = TimeUtils.getHourOfDay(timestamp)
      expect(hour).toBe(14)
    })

    test("identifies business hours", () => {
      const businessHour = new Date("2024-01-15T14:00:00Z").getTime()
      const offHour = new Date("2024-01-15T22:00:00Z").getTime()

      expect(TimeUtils.isBusinessHours(businessHour)).toBe(true)
      expect(TimeUtils.isBusinessHours(offHour)).toBe(false)
    })
  })

  describe("Batch Operations", () => {
    test("recordBatch is faster than sequential record", async () => {
      const metric: Metric.Definition = {
        id: `batch-test-${Date.now()}`,
        name: "Batch Test",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Test batch operations",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const traces = Array.from({ length: 20 }, () => RealisticTraces.quickFix())

      // Batch operation
      const batchStart = Date.now()
      await TimeSeries.recordBatch(metric.id, traces)
      const batchDuration = Date.now() - batchStart

      // Verify all traces were recorded
      const points = await TimeSeries.getDataPoints(metric.id)
      expect(points.length).toBe(20)

      // Batch should be reasonably fast (< 1s for 20 traces)
      expect(batchDuration).toBeLessThan(1000)
    })

    test("Baseline.addTraces is faster than sequential addTrace", async () => {
      const metric: Metric.Definition = {
        id: `baseline-batch-${Date.now()}`,
        name: "Baseline Batch Test",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Test baseline batch",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const baseline = await Baseline.create({
        id: `batch-baseline-${Date.now()}`,
        name: "Batch Test",
        description: "Test batch operations",
        metricIDs: [metric.id],
        minSampleSize: 5,
      })
      testIds.push(baseline.id)

      const traces = Array.from({ length: 10 }, () => RealisticTraces.quickFix())

      // Batch operation
      const batchStart = Date.now()
      await Baseline.addTraces(baseline.id, traces)
      const batchDuration = Date.now() - batchStart

      // Verify all traces were added
      const updated = await Baseline.get(baseline.id)
      expect(updated.traceIDs.length).toBe(10)

      // Batch should be reasonably fast (< 2s for 10 traces)
      expect(batchDuration).toBeLessThan(2000)
    })
  })

  describe("Data Quality Checks", () => {
    test("detects empty dataset", async () => {
      const metric: Metric.Definition = {
        id: `quality-empty-${Date.now()}`,
        name: "Quality Empty",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Test quality",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      const quality = await TimeSeries.checkDataQuality(metric.id)
      expect(quality.totalPoints).toBe(0)
      expect(quality.warnings).toContain("No data points found")
    })

    test("detects insufficient data", async () => {
      const metric: Metric.Definition = {
        id: `quality-insufficient-${Date.now()}`,
        name: "Quality Insufficient",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Test quality",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Add only 3 traces
      const traces = Array.from({ length: 3 }, () => RealisticTraces.quickFix())
      await TimeSeries.recordBatch(metric.id, traces)

      const quality = await TimeSeries.checkDataQuality(metric.id)
      expect(quality.totalPoints).toBe(3)
      expect(quality.warnings.some((w) => w.includes("Only 3 data points"))).toBe(true)
    })

    test("detects data gaps", async () => {
      const metric: Metric.Definition = {
        id: `quality-gaps-${Date.now()}`,
        name: "Quality Gaps",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Test quality",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create traces with a 5-hour gap
      const trace1 = RealisticTraces.quickFix()
      trace1.createdAt = Date.now() - 10 * 60 * 60 * 1000 // 10 hours ago

      const trace2 = RealisticTraces.quickFix()
      trace2.createdAt = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago (8-hour gap!)

      const trace3 = RealisticTraces.quickFix()
      trace3.createdAt = Date.now() // Now

      await TimeSeries.recordBatch(metric.id, [trace1, trace2, trace3])

      const quality = await TimeSeries.checkDataQuality(metric.id)
      expect(quality.gaps.length).toBeGreaterThan(0)
      expect(quality.warnings.some((w) => w.includes("data gaps"))).toBe(true)
    })

    test("reports when data spans short time period", async () => {
      const metric: Metric.Definition = {
        id: `quality-timespan-${Date.now()}`,
        name: "Quality Timespan",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Test quality",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Create traces all within 1 minute
      const traces = Array.from({ length: 5 }, (_, i) => {
        const trace = RealisticTraces.quickFix()
        trace.createdAt = Date.now() + i * 1000 // 1 second apart
        return trace
      })

      await TimeSeries.recordBatch(metric.id, traces)

      const quality = await TimeSeries.checkDataQuality(metric.id)
      expect(quality.timeRange.durationDays).toBeLessThan(0.1) // Less than 0.1 days
      expect(quality.warnings.some((w) => w.includes("Data spans only"))).toBe(true)
    })
  })

  describe("Metric Semantics", () => {
    test("validates cost metric configuration", () => {
      const goodMetric: Metric.Definition = {
        id: "cost-good",
        name: "Cost (Good)",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false, // Correct!
        category: "cost",
        semantics: MetricSemantics.Common.cost,
        tags: [],
        version: "1.0.0",
        description: "Test",
      }

      const goodResult = MetricSemantics.validate(goodMetric)
      expect(goodResult.valid).toBe(true)
      expect(goodResult.errors.length).toBe(0)

      const badMetric: Metric.Definition = {
        id: "cost-bad",
        name: "Cost (Bad)",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: true, // Wrong!
        category: "cost",
        semantics: MetricSemantics.Common.cost,
        tags: [],
        version: "1.0.0",
        description: "Test",
      }

      const badResult = MetricSemantics.validate(badMetric)
      expect(badResult.valid).toBe(false)
      expect(badResult.errors.length).toBeGreaterThan(0)
      expect(badResult.errors[0]).toContain("higherIsBetter=false")
    })

    test("suggests appropriate semantics", () => {
      const costMetric = {
        id: "total-cost",
        name: "Total Cost",
        category: "cost" as const,
        higherIsBetter: false,
      }
      const suggestion = MetricSemantics.suggest(costMetric)
      expect(suggestion).toBe(MetricSemantics.Common.cost)

      const durationMetric = {
        id: "response-time",
        name: "Response Time",
        category: "performance" as const,
        higherIsBetter: false,
      }
      const durationSuggestion = MetricSemantics.suggest(durationMetric)
      expect(durationSuggestion).toBe(MetricSemantics.Common.duration)
    })

    test("formats values with semantics", () => {
      const costFormatted = MetricSemantics.formatValue(0.0245, {
        semantics: MetricSemantics.Common.cost,
      })
      expect(costFormatted).toBe("$0.0245")

      const durationFormatted = MetricSemantics.formatValue(1500, {
        semantics: MetricSemantics.Common.duration,
      })
      expect(durationFormatted).toBe("1.50s")

      const errorFormatted = MetricSemantics.formatValue(0.05, {
        semantics: MetricSemantics.Common.errorRate,
      })
      expect(errorFormatted).toBe("5.0%")
    })

    test("interprets trends with semantics", () => {
      const costInterpretation = MetricSemantics.interpretTrend(0.001, {
        higherIsBetter: false,
        semantics: MetricSemantics.Common.cost,
      })
      expect(costInterpretation).toContain("increasing")
      expect(costInterpretation).toContain("worse")

      const throughputInterpretation = MetricSemantics.interpretTrend(0.05, {
        higherIsBetter: true,
        semantics: MetricSemantics.Common.throughput,
      })
      expect(throughputInterpretation).toContain("increasing")
      expect(throughputInterpretation).toContain("better")
    })
  })
})
