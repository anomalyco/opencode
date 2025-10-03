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

// Helper to create baseline with retry logic for robustness
async function createBaselineRobust(
  config: Parameters<typeof Baseline.create>[0],
  retries = 3
): Promise<ReturnType<typeof Baseline.create>> {
  for (let i = 0; i < retries; i++) {
    try {
      const baseline = await Baseline.create(config)
      // Verify it was actually created
      await Baseline.get(baseline.id)
      return baseline
    } catch (error) {
      if (i === retries - 1) throw error
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  throw new Error("Failed to create baseline")
}

// Helper to add traces with verification
async function addTracesRobust(
  baselineID: string,
  traces: any[],
  retries = 3
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      // Verify baseline exists first
      await Baseline.get(baselineID)
      
      // Add traces
      for (const trace of traces) {
        await Baseline.addTrace(baselineID, trace)
      }
      
      // Verify traces were added
      const updated = await Baseline.get(baselineID)
      if (updated.traceIDs.length >= traces.length) {
        return
      }
    } catch (error) {
      if (i === retries - 1) throw error
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

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
      const baseline = await createBaselineRobust({
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
      await addTracesRobust(baseline.id, haikuTraces)

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
      const baseline = await createBaselineRobust({
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
      await addTracesRobust(baseline.id, preOptTraces)

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
        higherIsBetter: false, // Cost going up is bad
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

      // Debug: check what values we actually got
      const points = await TimeSeries.getDataPoints(metric.id)
      const firstCost = points[0]?.value
      const lastCost = points[points.length - 1]?.value
      
      // Should detect degrading trend
      // Since higherIsBetter=false and cost is increasing, it should be "degrading"
      expect(lastCost).toBeGreaterThan(firstCost) // Cost should increase
      expect(analysis.slope).toBeGreaterThan(0) // Positive slope = increasing cost
      expect(analysis.trend).toBe("degrading")
      expect(Math.abs(analysis.changePercent)).toBeGreaterThan(5) // At least 5% change
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

      // Calculate average cost - sort into high and low cost groups
      // The simulator creates bimodal distribution: business hours (1.5x) vs off-hours (0.7x)
      const allCosts = points.map(p => p.value).sort((a, b) => a - b)
      const median = allCosts[Math.floor(allCosts.length / 2)]
      
      const lowCosts = allCosts.filter(c => c < median)
      const highCosts = allCosts.filter(c => c >= median)
      
      const avgLow = lowCosts.reduce((a, b) => a + b, 0) / lowCosts.length
      const avgHigh = highCosts.reduce((a, b) => a + b, 0) / highCosts.length

      // High-cost group should be significantly more expensive than low-cost group
      // With 1.5x vs 0.7x multipliers, ratio should be > 2x
      expect(lowCosts.length).toBeGreaterThan(0)
      expect(highCosts.length).toBeGreaterThan(0)
      expect(avgHigh).toBeGreaterThan(avgLow * 1.5)
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

      // Generate A/B test data (small sample for test performance)
      const { groupA, groupB } = TimeSeriesSimulator.abTest(5, 0.02, 0.028, 0.05)

      // Create baselines for both groups
      const baselineA = await createBaselineRobust({
        id: `group-a-${Date.now()}`,
        name: "Group A",
        description: "A/B test group A",
        metricIDs: [metric.id],
        tags: ["variant:A"],
        minSampleSize: 3,
      })
      testIds.push(baselineA.id)

      const baselineB = await createBaselineRobust({
        id: `group-b-${Date.now()}`,
        name: "Group B",
        description: "A/B test group B",
        metricIDs: [metric.id],
        tags: ["variant:B"],
        minSampleSize: 3,
      })
      testIds.push(baselineB.id)

      // Add traces to baselines with verification
      await addTracesRobust(baselineA.id, groupA)
      await addTracesRobust(baselineB.id, groupB)
      
      // Delay to ensure persistence
      await new Promise(resolve => setTimeout(resolve, 100))

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

      // Get all data points and verify the step change
      const points = await TimeSeries.getDataPoints(metric.id)
      expect(points.length).toBe(60)
      
      // Calculate averages before and after deployment
      const preDeployment = points.slice(0, 30).map(p => p.value)
      const postDeployment = points.slice(30, 60).map(p => p.value)
      
      const avgPre = preDeployment.reduce((a, b) => a + b, 0) / preDeployment.length
      const avgPost = postDeployment.reduce((a, b) => a + b, 0) / postDeployment.length
      
      // Should detect ~100% increase (0.02 → 0.04)
      expect(avgPost).toBeGreaterThan(avgPre * 1.8) // At least 80% increase
      expect(avgPost / avgPre).toBeCloseTo(2.0, 0.3) // Close to 2x
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

      // Record all traces with timestamps spread over 7 days
      const allTraces = [
        ...explorationTraces,
        ...implementationTraces,
        ...polishingTraces,
      ]
      const startTime = Date.now() - 7 * 24 * 60 * 60 * 1000
      const timeStep = (7 * 24 * 60 * 60 * 1000) / allTraces.length
      
      for (let i = 0; i < allTraces.length; i++) {
        const trace = allTraces[i]
        // Override timestamp to spread traces over 7 days
        trace.createdAt = Math.floor(startTime + i * timeStep)
        trace.completedAt = trace.createdAt + trace.summary.duration
        await TimeSeries.record(costMetric.id, trace)
      }

      // Analyze trend (should show improvement over time)
      const trend = await TimeSeries.analyzeTrend(costMetric.id, { days: 7 })

      // Should detect improving trend as work becomes more efficient
      // With higherIsBetter=false (cost), decreasing values = improving
      expect(trend.trend).toBe("improving")
      expect(trend.slope).toBeLessThan(0) // Negative slope = decreasing cost
      expect(trend.changePercent).toBeLessThan(-5) // At least 5% improvement
    })
  })
})
