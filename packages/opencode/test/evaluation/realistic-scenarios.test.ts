import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EvaluationIntegration } from "../../src/evaluation/integration"
import { Metric } from "../../src/evaluation/metric"
import { Baseline } from "../../src/evaluation/baseline"
import { TimeSeries } from "../../src/evaluation/timeseries"
import { RealisticTraces } from "./fixtures/realistic-traces"
import { TimeSeriesSimulator } from "./helpers/time-series-simulation"

/**
 * Realistic scenario tests using production-like trace patterns.
 * 
 * These tests validate the evaluation framework with:
 * - Real trace patterns from actual agent behavior
 * - Time-series patterns observed in production
 * - Complex workflows and edge cases
 */

describe("Realistic Evaluation Scenarios", () => {
  const testIds: string[] = []

  beforeEach(async () => {
    EvaluationIntegration.disableAutoEvaluation()
  })

  afterEach(async () => {
    EvaluationIntegration.disableAutoEvaluation()
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

  describe("Real-World Trace Patterns", () => {
    test("detects regression when switching from Haiku to Sonnet", async () => {
      const durationMetric: Metric.Definition = {
        id: `model-switch-${Date.now()}`,
        name: "Response Duration",
        evaluator: { type: "heuristic", function: "responseDuration" },
        higherIsBetter: false,
        category: "performance",
        tags: [],
        version: "1.0.0",
        description: "Measures response time",
      }
      await Metric.register(durationMetric)
      testIds.push(durationMetric.id)

      // Baseline with fast Haiku model
      const baseline = await Baseline.create({
        id: `haiku-baseline-${Date.now()}`,
        name: "Haiku Model Baseline",
        description: "Baseline for Haiku model performance",
        metricIDs: [durationMetric.id],
        tags: ["model:haiku"],
        minSampleSize: 5,
      })
      testIds.push(baseline.id)

      // Add Haiku traces to baseline
      const haikuTraces = RealisticTraces.generateVariations(
        RealisticTraces.haikuModel,
        10,
        0.1
      )
      for (const trace of haikuTraces) {
        await Baseline.addTrace(baseline.id, trace)
      }

      // Monitor for regressions
      const regressions: any[] = []
      const unsubscribe = EvaluationIntegration.onRegression((alert) => {
        regressions.push(alert)
      })

      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [durationMetric.id],
        checkBaselines: true,
      })

      // Switch to Sonnet model (slower but higher quality)
      const sonnetTrace = RealisticTraces.successfulCodeEdit()
      await EvaluationIntegration.evaluateTrace(sonnetTrace)

      // Should detect that Sonnet is significantly slower
      expect(regressions.length).toBeGreaterThan(0)
      expect(regressions[0].currentValue).toBeGreaterThan(
        regressions[0].baselineValue
      )

      unsubscribe()
    })

    test("detects improvement from code optimization", async () => {
      const costMetric: Metric.Definition = {
        id: `optimization-${Date.now()}`,
        name: "Total Cost",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Measures total cost",
      }
      await Metric.register(costMetric)
      testIds.push(costMetric.id)

      // Baseline with pre-optimization traces
      const baseline = await Baseline.create({
        id: `pre-opt-baseline-${Date.now()}`,
        name: "Pre-Optimization",
        description: "Baseline before optimization",
        metricIDs: [costMetric.id],
        minSampleSize: 5,
      })
      testIds.push(baseline.id)

      // Add expensive complex refactoring traces
      const preOptTraces = RealisticTraces.generateVariations(
        RealisticTraces.complexRefactoring,
        10,
        0.15
      )
      for (const trace of preOptTraces) {
        await Baseline.addTrace(baseline.id, trace)
      }

      // Monitor for improvements
      const improvements: any[] = []
      const unsubscribe = EvaluationIntegration.onImprovement((alert) => {
        improvements.push(alert)
      })

      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [costMetric.id],
        checkBaselines: true,
      })

      // After optimization: uses cache heavily
      const optimizedTrace = RealisticTraces.cachedExecution()
      await EvaluationIntegration.evaluateTrace(optimizedTrace)

      // Should detect significant cost reduction
      expect(improvements.length).toBeGreaterThan(0)
      expect(improvements[0].currentValue).toBeLessThan(
        improvements[0].baselineValue
      )

      unsubscribe()
    })

    test("handles retry patterns correctly", async () => {
      const errorMetric: Metric.Definition = {
        id: `error-rate-${Date.now()}`,
        name: "Tool Error Rate",
        evaluator: { type: "heuristic", function: "toolErrorRate" },
        higherIsBetter: false,
        category: "reliability",
        tags: [],
        version: "1.0.0",
        description: "Measures error rate",
      }
      await Metric.register(errorMetric)
      testIds.push(errorMetric.id)

      // Successful traces have low error rate
      const successTrace = RealisticTraces.successfulCodeEdit()
      await EvaluationIntegration.evaluateTrace(
        successTrace,
        {
          metricIDs: [errorMetric.id],
          recordTimeSeries: true,
        }
      )

      // Retry traces have errors but eventually succeed
      const retryTrace = RealisticTraces.failedWithRetry()
      await EvaluationIntegration.evaluateTrace(retryTrace, {
        metricIDs: [errorMetric.id],
        recordTimeSeries: true,
      })

      // Error rate should be > 0 for retry trace
      const points = await TimeSeries.getDataPoints(errorMetric.id)
      expect(points.length).toBe(2)

      const retryPoint = points.find((p) => p.traceID === retryTrace.id)
      expect(retryPoint).toBeDefined()
      expect(retryPoint!.value).toBeGreaterThan(0)
    })
  })

  describe("Time-Series Patterns", () => {
    test("detects anomaly in stable pattern", async () => {
      const metric: Metric.Definition = {
        id: `stable-anomaly-${Date.now()}`,
        name: "Cost Monitoring",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Monitors cost",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Generate stable baseline with 2% variance
      const stableTraces = TimeSeriesSimulator.stable(50, 0.02, 0.02)
      for (const trace of stableTraces) {
        await TimeSeries.record(metric.id, trace)
      }

      // Monitor for anomalies
      const anomalies: any[] = []
      const unsubscribe = EvaluationIntegration.onAnomaly((alert) => {
        anomalies.push(alert)
      })

      await EvaluationIntegration.enableAutoEvaluation({
        metricIDs: [metric.id],
        recordTimeSeries: true,
        detectAnomalies: true,
      })

      // Inject anomalous trace (10x normal)
      const anomalousTrace = RealisticTraces.custom({
        summary: {
          duration: 1000,
          toolCallCount: 1,
          errorCount: 0,
          tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.20, // 10x normal
        },
      })

      await EvaluationIntegration.evaluateTrace(anomalousTrace)

      expect(anomalies.length).toBeGreaterThan(0)
      expect(anomalies[0].zScore).toBeGreaterThan(3)

      unsubscribe()
    })

    test("detects gradual degradation over time", async () => {
      const metric: Metric.Definition = {
        id: `degradation-${Date.now()}`,
        name: "Performance Degradation",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Detects degradation",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Generate degrading pattern: 10% increase over 100 samples
      const degradingTraces = TimeSeriesSimulator.degradation(100, 0.10, 0.02)
      for (const trace of degradingTraces) {
        await TimeSeries.record(metric.id, trace)
      }

      // Analyze trend
      const analysis = await TimeSeries.analyzeTrend(metric.id, {
        days: 4, // ~100 hours
      })

      // Should detect degrading trend
      expect(analysis.trend).toBe("degrading")
      expect(analysis.slope).toBeGreaterThan(0) // Positive slope = increasing cost
      expect(analysis.changePercent).toBeGreaterThan(5) // At least 5% increase
    })

    test("identifies business hours vs off-hours patterns", async () => {
      const metric: Metric.Definition = {
        id: `daily-pattern-${Date.now()}`,
        name: "Daily Pattern",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Daily usage pattern",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Generate 7 days of hourly data with business hours pattern
      const dailyTraces = TimeSeriesSimulator.dailyPattern(7, 24, 0.02, 0.05)
      for (const trace of dailyTraces) {
        await TimeSeries.record(metric.id, trace)
      }

      // Get all data points
      const points = await TimeSeries.getDataPoints(metric.id)
      expect(points.length).toBe(7 * 24) // 7 days, 24 hours each

      // Calculate average cost during business hours vs off-hours
      const businessHoursCosts: number[] = []
      const offHoursCosts: number[] = []

      for (const point of points) {
        const hour = new Date(point.timestamp).getHours()
        const isBusinessHours = hour >= 9 && hour <= 17

        if (isBusinessHours) {
          businessHoursCosts.push(point.value)
        } else {
          offHoursCosts.push(point.value)
        }
      }

      const avgBusinessHours =
        businessHoursCosts.reduce((a, b) => a + b, 0) / businessHoursCosts.length
      const avgOffHours =
        offHoursCosts.reduce((a, b) => a + b, 0) / offHoursCosts.length

      // Business hours should be ~1.5x more expensive
      expect(businessHoursCosts.length).toBeGreaterThan(0)
      expect(offHoursCosts.length).toBeGreaterThan(0)
      expect(avgBusinessHours).toBeGreaterThan(avgOffHours * 1.3)
    })

    test("handles A/B test comparison", async () => {
      const metric: Metric.Definition = {
        id: `ab-test-${Date.now()}`,
        name: "A/B Test",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "A/B test comparison",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Generate A/B test data (reduce sample size for test performance)
      const { groupA, groupB } = TimeSeriesSimulator.abTest(20, 0.02, 0.028, 0.1)

      // Create baselines for both groups
      const baselineA = await Baseline.create({
        id: `group-a-${Date.now()}`,
        name: "Group A",
        description: "A/B test group A",
        metricIDs: [metric.id],
        tags: ["variant:A"],
        minSampleSize: 10,
      })
      testIds.push(baselineA.id)

      const baselineB = await Baseline.create({
        id: `group-b-${Date.now()}`,
        name: "Group B",
        description: "A/B test group B",
        metricIDs: [metric.id],
        tags: ["variant:B"],
        minSampleSize: 10,
      })
      testIds.push(baselineB.id)

      // Add traces to baselines  
      for (const trace of groupA) {
        await Baseline.addTrace(baselineA.id, trace)
      }
      
      for (const trace of groupB) {
        await Baseline.addTrace(baselineB.id, trace)
      }
      
      // Small delay to ensure persistence
      await new Promise(resolve => setTimeout(resolve, 50))

      // Compare the two baselines
      const comparison = await Baseline.compareAB(baselineA.id, baselineB.id)

      // Group B should be more expensive (0.028 vs 0.02 = 40% increase)
      expect(comparison.metrics[0].percentChange).toBeGreaterThan(20)
      expect(comparison.metrics[0].meanB).toBeGreaterThan(
        comparison.metrics[0].meanA
      )
    })

    test("detects step function change after deployment", async () => {
      const metric: Metric.Definition = {
        id: `deployment-${Date.now()}`,
        name: "Deployment Impact",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Detects deployment impact",
      }
      await Metric.register(metric)
      testIds.push(metric.id)

      // Generate step function: sudden change at deployment
      const stepTraces = TimeSeriesSimulator.stepFunction(30, 30, 0.02, 0.04)
      for (const trace of stepTraces) {
        await TimeSeries.record(metric.id, trace)
      }

      // Create baseline from pre-deployment period
      const baseline = await Baseline.create({
        id: `pre-deploy-${Date.now()}`,
        name: "Pre-Deployment",
        description: "Baseline before deployment",
        metricIDs: [metric.id],
        minSampleSize: 10,
      })
      testIds.push(baseline.id)

      for (const trace of stepTraces.slice(0, 30)) {
        await Baseline.addTrace(baseline.id, trace)
      }
      
      // Small delay to ensure persistence
      await new Promise(resolve => setTimeout(resolve, 50))

      // Compare post-deployment trace
      const postDeployTrace = stepTraces[50]
      const comparison = await Baseline.compare(baseline.id, postDeployTrace)

      // Should detect 100% increase (0.02 → 0.04)
      expect(comparison.regressions).toContain(metric.id)
      expect(comparison.metrics[0].percentChange).toBeGreaterThan(80)
    })
  })

  describe("Complex Workflows", () => {
    test("simulates week-long development cycle", async () => {
      const costMetric: Metric.Definition = {
        id: `dev-cycle-${Date.now()}`,
        name: "Development Cycle",
        evaluator: { type: "heuristic", function: "totalCost" },
        higherIsBetter: false,
        category: "cost",
        tags: [],
        version: "1.0.0",
        description: "Tracks development cycle",
      }
      await Metric.register(costMetric)
      testIds.push(costMetric.id)

      // Phase 1: Exploration (expensive, complex tasks)
      const explorationTraces = RealisticTraces.generateVariations(
        RealisticTraces.complexRefactoring,
        20,
        0.2
      )

      // Phase 2: Implementation (mixed complexity)
      const implementationTraces = [
        ...RealisticTraces.generateVariations(
          RealisticTraces.successfulCodeEdit,
          15,
          0.15
        ),
        ...RealisticTraces.generateVariations(RealisticTraces.failedWithRetry, 5, 0.1),
      ]

      // Phase 3: Polishing (cheap, cached tasks)
      const polishingTraces = RealisticTraces.generateVariations(
        RealisticTraces.cachedExecution,
        30,
        0.1
      )

      // Record all traces
      const allTraces = [
        ...explorationTraces,
        ...implementationTraces,
        ...polishingTraces,
      ]
      for (const trace of allTraces) {
        await TimeSeries.record(costMetric.id, trace)
      }

      // Analyze trend (should show improvement over time)
      const trend = await TimeSeries.analyzeTrend(costMetric.id, { days: 7 })

      // Should detect improving trend as work becomes more efficient
      expect(trend.trend).toBe("improving")
      expect(trend.slope).toBeLessThan(0) // Negative slope = decreasing cost
    })
  })
})
