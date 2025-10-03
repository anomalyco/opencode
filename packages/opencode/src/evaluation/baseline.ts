import z from "zod/v4"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import type { Trace } from "../trace"
import { EvaluationEngine } from "./engine"

/**
 * Baseline management for comparative analysis and regression detection.
 * 
 * Baselines serve as reference points for tracking metric performance over time.
 * They enable:
 * - Regression detection by comparing new traces to established baselines
 * - A/B testing by comparing two different configurations
 * - Performance tracking across versions/iterations
 * - Statistical analysis of metric distributions
 * 
 * @example
 * ```typescript
 * // Create a baseline from current production performance
 * const baseline = await Baseline.create({
 *   id: "prod-v1.0",
 *   name: "Production Baseline v1.0",
 *   description: "Performance baseline for initial release",
 *   metricIDs: ["error-rate", "response-time", "cost"],
 *   tags: ["production", "v1.0"]
 * })
 * 
 * // Add traces to the baseline
 * await Baseline.addTrace(baseline.id, trace)
 * 
 * // Compare new trace against baseline
 * const comparison = await Baseline.compare(baseline.id, newTrace)
 * if (comparison.regressions.length > 0) {
 *   console.warn("Performance regression detected!")
 * }
 * ```
 */
export namespace Baseline {
  /**
   * Statistical summary of metric values in a baseline.
   */
  export const Statistics = z.object({
    metricID: z.string(),
    count: z.number(),
    mean: z.number(),
    median: z.number(),
    stdDev: z.number(),
    min: z.number(),
    max: z.number(),
    p50: z.number(),
    p95: z.number(),
    p99: z.number(),
  })
  export type Statistics = z.infer<typeof Statistics>

  /**
   * A baseline definition with reference trace data.
   */
  export const Definition = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    
    // Metrics to track in this baseline
    metricIDs: z.array(z.string()),
    
    // Reference traces
    traceIDs: z.array(z.string()).default([]),
    
    // Computed statistics
    statistics: z.array(Statistics).default([]),
    
    // Configuration
    minSampleSize: z.number().default(10),
    regressionThreshold: z.number().default(0.1), // 10% degradation
    
    // Metadata
    tags: z.array(z.string()).default([]),
    createdAt: z.number(),
    updatedAt: z.number(),
    version: z.string().default("1.0.0"),
  })
  export type Definition = z.infer<typeof Definition>

  /**
   * Result of comparing a trace against a baseline.
   */
  export const ComparisonResult = z.object({
    baselineID: z.string(),
    traceID: z.string(),
    
    // Per-metric comparison
    metrics: z.array(
      z.object({
        metricID: z.string(),
        baselineValue: z.number(), // Mean from baseline
        traceValue: z.number(),
        delta: z.number(), // Absolute difference
        percentChange: z.number(), // Percentage change
        isRegression: z.boolean(),
        zScore: z.number().optional(), // How many std devs from mean
      }),
    ),
    
    // Summary
    regressions: z.array(z.string()), // Metric IDs with regressions
    improvements: z.array(z.string()), // Metric IDs with improvements
    overallScore: z.number(), // 0-1, weighted average of metrics
    
    timestamp: z.number(),
  })
  export type ComparisonResult = z.infer<typeof ComparisonResult>

  /**
   * A/B test comparison between two baselines.
   */
  export const ABTestResult = z.object({
    baselineA: z.string(),
    baselineB: z.string(),
    
    // Per-metric statistical comparison
    metrics: z.array(
      z.object({
        metricID: z.string(),
        meanA: z.number(),
        meanB: z.number(),
        medianA: z.number(),
        medianB: z.number(),
        delta: z.number(),
        percentChange: z.number(),
        winner: z.enum(["A", "B", "tie"]),
        confidence: z.number(), // 0-1, statistical confidence
      }),
    ),
    
    // Overall winner
    overallWinner: z.enum(["A", "B", "tie"]),
    sampleSizeA: z.number(),
    sampleSizeB: z.number(),
    
    timestamp: z.number(),
  })
  export type ABTestResult = z.infer<typeof ABTestResult>

  export const Event = {
    Created: Bus.event(
      "baseline.created",
      z.object({
        baselineID: z.string(),
      }),
    ),
    Updated: Bus.event(
      "baseline.updated",
      z.object({
        baselineID: z.string(),
      }),
    ),
    RegressionDetected: Bus.event(
      "baseline.regression",
      z.object({
        baselineID: z.string(),
        traceID: z.string(),
        regressions: z.array(z.string()),
      }),
    ),
  }

  /**
   * Create a new baseline.
   * 
   * @param baseline - The baseline configuration
   * @returns The created baseline definition
   * 
   * @example
   * ```typescript
   * const baseline = await Baseline.create({
   *   id: "prod-baseline",
   *   name: "Production Baseline",
   *   description: "Reference performance for production",
   *   metricIDs: ["error-rate", "latency"],
   *   tags: ["production"]
   * })
   * ```
   */
  export async function create(
    baseline: Pick<Definition, "id" | "name" | "description" | "metricIDs"> & 
    Partial<Omit<Definition, "id" | "name" | "description" | "metricIDs" | "createdAt" | "updatedAt">>
  ): Promise<Definition> {
    const now = Date.now()
    const complete: Definition = {
      traceIDs: [],
      statistics: [],
      minSampleSize: 10,
      regressionThreshold: 0.1,
      tags: [],
      version: "1.0.0",
      ...baseline,
      createdAt: now,
      updatedAt: now,
    }
    
    await Storage.write(["baseline", baseline.id], complete)
    Bus.publish(Event.Created, { baselineID: baseline.id })
    
    return complete
  }

  /**
   * Get a baseline by ID.
   * 
   * @param id - The baseline ID
   * @returns The baseline definition
   */
  export async function get(id: string): Promise<Definition> {
    return Storage.read<Definition>(["baseline", id])
  }

  /**
   * List all baselines.
   * 
   * @returns Array of baseline definitions
   */
  export async function list(): Promise<Definition[]> {
    const keys = await Storage.list(["baseline"])
    const baselines: Definition[] = []
    
    for (const key of keys) {
      const baseline = await Storage.read<Definition>(key)
      baselines.push(baseline)
    }
    
    return baselines.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Add a trace to a baseline and update statistics.
   * 
   * Evaluates the trace against all baseline metrics and updates
   * the statistical distribution.
   * 
   * @param baselineID - The baseline ID
   * @param trace - The trace to add
   * 
   * @example
   * ```typescript
   * await Baseline.addTrace("prod-baseline", trace)
   * ```
   */
  export async function addTrace(baselineID: string, trace: Trace.Complete): Promise<void> {
    const baseline = await get(baselineID)
    const { Metric } = await import("./metric")
    
    // Get all metrics for this baseline
    const metrics = await Promise.all(baseline.metricIDs.map((id) => Metric.get(id)))
    
    // Evaluate trace against all metrics
    await EvaluationEngine.evaluateMany(trace, metrics)
    
    // Add trace to baseline
    baseline.traceIDs.push(trace.id)
    
    // Update statistics
    baseline.statistics = await computeStatistics(baselineID, baseline.metricIDs)
    baseline.updatedAt = Date.now()
    
    await Storage.write(["baseline", baselineID], baseline)
    Bus.publish(Event.Updated, { baselineID })
  }

  /**
   * Compare a trace against a baseline.
   * 
   * Evaluates the trace and compares each metric against the baseline's
   * statistical distribution to detect regressions or improvements.
   * 
   * @param baselineID - The baseline to compare against
   * @param trace - The trace to evaluate
   * @returns Comparison result with regression detection
   * 
   * @example
   * ```typescript
   * const comparison = await Baseline.compare("prod-baseline", trace)
   * if (comparison.regressions.length > 0) {
   *   console.error(`Regressions detected: ${comparison.regressions.join(", ")}`)
   * }
   * ```
   */
  export async function compare(baselineID: string, trace: Trace.Complete): Promise<ComparisonResult> {
    const baseline = await get(baselineID)
    const { Metric } = await import("./metric")
    
    if (baseline.traceIDs.length < baseline.minSampleSize) {
      throw new Error(`Baseline ${baselineID} needs at least ${baseline.minSampleSize} traces`)
    }
    
    // Get all metrics and evaluate trace
    const metrics = await Promise.all(baseline.metricIDs.map((id) => Metric.get(id)))
    const results = await EvaluationEngine.evaluateMany(trace, metrics)
    
    const metricComparisons = []
    const regressions: string[] = []
    const improvements: string[] = []
    
    for (const result of results) {
      const stats = baseline.statistics.find((s) => s.metricID === result.metricID)
      if (!stats) continue
      
      const metric = metrics.find((m) => m.id === result.metricID)!
      const traceValue = result.score
      const baselineValue = stats.mean
      const delta = traceValue - baselineValue
      const percentChange = baselineValue === 0 ? 0 : (delta / baselineValue) * 100
      const zScore = stats.stdDev === 0 ? 0 : delta / stats.stdDev
      
      // Determine if this is a regression based on metric direction
      const isWorse = metric.higherIsBetter ? delta < 0 : delta > 0
      
      // For regression detection:
      // - Use percent change if baseline is non-zero
      // - Use absolute delta if baseline is zero (any change from 0 is significant)
      const isRegression = baselineValue === 0
        ? isWorse && Math.abs(delta) > baseline.regressionThreshold
        : isWorse && Math.abs(percentChange) > baseline.regressionThreshold * 100
      
      if (isRegression) {
        regressions.push(result.metricID)
      } else {
        // Check for improvements using same logic
        const isImprovement = baselineValue === 0
          ? !isWorse && Math.abs(delta) > baseline.regressionThreshold
          : !isWorse && Math.abs(percentChange) > baseline.regressionThreshold * 100
        
        if (isImprovement) {
          improvements.push(result.metricID)
        }
      }
      
      metricComparisons.push({
        metricID: result.metricID,
        baselineValue,
        traceValue,
        delta,
        percentChange,
        isRegression,
        zScore,
      })
    }
    
    // Compute overall score (weighted average of normalized scores)
    const overallScore = metricComparisons.reduce((sum, m) => {
      const normalizedScore = m.isRegression ? 0 : 1
      return sum + normalizedScore
    }, 0) / metricComparisons.length
    
    const comparisonResult: ComparisonResult = {
      baselineID,
      traceID: trace.id,
      metrics: metricComparisons,
      regressions,
      improvements,
      overallScore,
      timestamp: Date.now(),
    }
    
    // Store comparison result
    await Storage.write(["baseline-comparison", baselineID, trace.id], comparisonResult)
    
    // Emit event if regressions detected
    if (regressions.length > 0) {
      Bus.publish(Event.RegressionDetected, {
        baselineID,
        traceID: trace.id,
        regressions,
      })
    }
    
    return comparisonResult
  }

  /**
   * Compare two baselines for A/B testing.
   * 
   * Performs statistical comparison between two baselines to determine
   * which performs better across tracked metrics.
   * 
   * @param baselineAID - First baseline ID
   * @param baselineBID - Second baseline ID
   * @returns A/B test comparison result
   * 
   * @example
   * ```typescript
   * const result = await Baseline.compareAB("v1-baseline", "v2-baseline")
   * console.log(`Winner: ${result.overallWinner}`)
   * result.metrics.forEach(m => {
   *   console.log(`${m.metricID}: ${m.winner} wins by ${m.percentChange.toFixed(1)}%`)
   * })
   * ```
   */
  export async function compareAB(baselineAID: string, baselineBID: string): Promise<ABTestResult> {
    const baselineA = await get(baselineAID)
    const baselineB = await get(baselineBID)
    
    if (baselineA.traceIDs.length < baselineA.minSampleSize) {
      throw new Error(`Baseline A needs at least ${baselineA.minSampleSize} traces`)
    }
    if (baselineB.traceIDs.length < baselineB.minSampleSize) {
      throw new Error(`Baseline B needs at least ${baselineB.minSampleSize} traces`)
    }
    
    const metricComparisons = []
    let aWins = 0
    let bWins = 0
    
    // Compare each metric that exists in both baselines
    const commonMetrics = baselineA.metricIDs.filter((id) => baselineB.metricIDs.includes(id))
    const { Metric } = await import("./metric")
    
    for (const metricID of commonMetrics) {
      const statsA = baselineA.statistics.find((s) => s.metricID === metricID)
      const statsB = baselineB.statistics.find((s) => s.metricID === metricID)
      
      if (!statsA || !statsB) continue
      
      const metric = await Metric.get(metricID)
      const delta = statsB.mean - statsA.mean
      const percentChange = statsA.mean === 0 ? 0 : (delta / statsA.mean) * 100
      
      // Determine winner based on metric direction
      let winner: "A" | "B" | "tie"
      if (Math.abs(percentChange) < 1) {
        winner = "tie"
      } else if (metric.higherIsBetter) {
        winner = delta > 0 ? "B" : "A"
      } else {
        winner = delta < 0 ? "B" : "A"
      }
      
      if (winner === "A") aWins++
      if (winner === "B") bWins++
      
      // Simple confidence based on sample size and effect size
      const minSampleSize = Math.min(statsA.count, statsB.count)
      const effectSize = Math.abs(delta) / Math.max(statsA.stdDev, statsB.stdDev, 1)
      const confidence = Math.min(0.99, (minSampleSize / 100) * effectSize)
      
      metricComparisons.push({
        metricID,
        meanA: statsA.mean,
        meanB: statsB.mean,
        medianA: statsA.median,
        medianB: statsB.median,
        delta,
        percentChange,
        winner,
        confidence,
      })
    }
    
    const overallWinner = aWins > bWins ? "A" : bWins > aWins ? "B" : "tie"
    
    const result: ABTestResult = {
      baselineA: baselineAID,
      baselineB: baselineBID,
      metrics: metricComparisons,
      overallWinner,
      sampleSizeA: baselineA.traceIDs.length,
      sampleSizeB: baselineB.traceIDs.length,
      timestamp: Date.now(),
    }
    
    // Store A/B test result
    await Storage.write(["ab-test", `${baselineAID}-vs-${baselineBID}`, Date.now().toString()], result)
    
    return result
  }

  /**
   * Find baselines by tag.
   * 
   * @param tag - The tag to filter by
   * @returns Array of baselines with the specified tag
   */
  export async function findByTag(tag: string): Promise<Definition[]> {
    const all = await list()
    return all.filter((b) => b.tags.includes(tag))
  }

  /**
   * Remove a baseline.
   * 
   * @param id - The baseline ID to remove
   */
  export async function remove(id: string): Promise<void> {
    await Storage.remove(["baseline", id])
  }

  /**
   * Compute statistics for a baseline's metrics.
   * 
   * @param baselineID - The baseline ID
   * @param metricIDs - Metric IDs to compute statistics for
   * @returns Array of statistics per metric
   */
  async function computeStatistics(baselineID: string, metricIDs: string[]): Promise<Statistics[]> {
    const stats: Statistics[] = []
    
    for (const metricID of metricIDs) {
      // Get all evaluation results for this metric in this baseline
      const results = await EvaluationEngine.getResultsForMetric(metricID)
      const baseline = await get(baselineID)
      
      // Filter to only results from baseline traces
      const baselineResults = results.filter((r) => baseline.traceIDs.includes(r.traceID))
      
      if (baselineResults.length === 0) {
        continue
      }
      
      const scores = baselineResults.map((r) => r.score).sort((a, b) => a - b)
      const count = scores.length
      
      const mean = scores.reduce((sum, s) => sum + s, 0) / count
      const median = scores[Math.floor(count / 2)]
      const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / count
      const stdDev = Math.sqrt(variance)
      const min = scores[0]
      const max = scores[count - 1]
      const p50 = scores[Math.floor(count * 0.5)]
      const p95 = scores[Math.floor(count * 0.95)]
      const p99 = scores[Math.floor(count * 0.99)]
      
      stats.push({
        metricID,
        count,
        mean,
        median,
        stdDev,
        min,
        max,
        p50,
        p95,
        p99,
      })
    }
    
    return stats
  }
}
