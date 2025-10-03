import z from "zod/v4"
import { Storage } from "../storage/storage"
import type { Trace } from "../trace"
import { EvaluationEngine } from "./engine"
import { TimeUtils } from "./time-utils"

/**
 * Time-series analysis for tracking metric trends over time.
 * 
 * Enables tracking of metric performance across temporal dimensions:
 * - Hourly, daily, weekly aggregations
 * - Trend detection (improving, degrading, stable)
 * - Anomaly detection based on historical patterns
 * - Rolling window statistics
 * 
 * @example
 * ```typescript
 * // Track metrics over time
 * await TimeSeries.record("error-rate", trace)
 * 
 * // Get daily aggregates for the last 7 days
 * const trend = await TimeSeries.getAggregates("error-rate", {
 *   period: "day",
 *   since: Date.now() - 7 * 24 * 60 * 60 * 1000
 * })
 * 
 * // Detect trends
 * const analysis = await TimeSeries.analyzeTrend("error-rate", { days: 7 })
 * if (analysis.trend === "degrading") {
 *   console.warn("Metric is degrading over time")
 * }
 * ```
 */
export namespace TimeSeries {
  /**
   * A single data point in a time series.
   */
  export const DataPoint = z.object({
    metricID: z.string(),
    traceID: z.string(),
    value: z.number(),
    timestamp: z.number(),
    
    // Context
    tags: z.record(z.string(), z.string()).optional(),
  })
  export type DataPoint = z.infer<typeof DataPoint>

  /**
   * Aggregated statistics for a time period.
   */
  export const Aggregate = z.object({
    metricID: z.string(),
    period: z.enum(["hour", "day", "week", "month"]),
    periodStart: z.number(),
    periodEnd: z.number(),
    
    // Statistics
    count: z.number(),
    mean: z.number(),
    median: z.number(),
    min: z.number(),
    max: z.number(),
    stdDev: z.number(),
    p50: z.number(),
    p95: z.number(),
    p99: z.number(),
  })
  export type Aggregate = z.infer<typeof Aggregate>

  /**
   * Trend analysis result.
   */
  export const TrendAnalysis = z.object({
    metricID: z.string(),
    period: z.object({
      start: z.number(),
      end: z.number(),
      days: z.number(),
    }),
    
    // Trend direction
    trend: z.enum(["improving", "degrading", "stable"]),
    trendStrength: z.number(), // 0-1, how strong the trend is
    
    // Statistical measures
    slope: z.number(), // Rate of change per day
    correlation: z.number(), // -1 to 1, linear correlation with time
    
    // Data points
    dataPoints: z.number(),
    mean: z.number(),
    changePercent: z.number(),
    
    // Anomalies detected
    anomalies: z.array(
      z.object({
        timestamp: z.number(),
        value: z.number(),
        expectedValue: z.number(),
        deviationSigmas: z.number(),
      }),
    ),
  })
  export type TrendAnalysis = z.infer<typeof TrendAnalysis>

  /**
   * Record a metric value for time-series tracking.
   * 
   * @param metricID - The metric to track
   * @param trace - The trace containing the metric evaluation
   * @param tags - Optional tags for filtering/grouping
   * 
   * @example
   * ```typescript
   * await TimeSeries.record("latency", trace, {
   *   environment: "production",
   *   version: "v1.2.0"
   * })
   * ```
   */
  export async function record(
    metricID: string,
    trace: Trace.Complete,
    tags?: Record<string, string>,
  ): Promise<void> {
    const { Metric } = await import("./metric")
    const metric = await Metric.get(metricID)
    
    // Evaluate the metric
    const result = await EvaluationEngine.evaluate(trace, metric)
    
    // Validate and use trace timestamp
    const timestamp = TimeUtils.validateTimestamp(
      trace.createdAt || Date.now(),
      `TimeSeries.record(${metricID}, ${trace.id})`,
      { warnIfOlderThanDays: 90 }
    )

    const dataPoint: DataPoint = {
      metricID,
      traceID: trace.id,
      value: result.score,
      timestamp,
      tags,
    }
    
    // Store in time-series bucket
    const hourBucket = Math.floor(timestamp / (60 * 60 * 1000)) // Hourly buckets
    await Storage.write(["timeseries", metricID, hourBucket.toString(), trace.id], dataPoint)
  }

  /**
   * Record multiple traces efficiently in a single batch operation.
   * Much faster than calling record() in a loop.
   * 
   * @param metricID - The metric ID
   * @param traces - Array of traces to record
   * @param tags - Optional tags to apply to all data points
   * 
   * @example
   * ```typescript
   * const traces = generateHistoricalTraces(100)
   * await TimeSeries.recordBatch("cost-metric", traces)
   * ```
   */
  export async function recordBatch(
    metricID: string,
    traces: Trace.Complete[],
    tags?: Record<string, string>
  ): Promise<void> {
    const { Metric } = await import("./metric")
    const metric = await Metric.get(metricID)

    // Evaluate all traces in parallel
    const dataPoints = await Promise.all(
      traces.map(async (trace) => {
        const result = await EvaluationEngine.evaluate(trace, metric)
        const timestamp = TimeUtils.validateTimestamp(
          trace.createdAt || Date.now(),
          `TimeSeries.recordBatch(${metricID})`,
          { warnIfOlderThanDays: 90 }
        )

        return {
          metricID,
          traceID: trace.id,
          value: result.score,
          timestamp,
          tags,
        }
      })
    )

    // Write all data points in parallel
    await Promise.all(
      dataPoints.map(async (point) => {
        const hourBucket = Math.floor(point.timestamp / (60 * 60 * 1000))
        await Storage.write(
          ["timeseries", metricID, hourBucket.toString(), point.traceID],
          point
        )
      })
    )
  }

  /**
   * Get raw data points for a metric within a time range.
   * 
   * @param metricID - The metric ID
   * @param options - Query options
   * @returns Array of data points
   */
  export async function getDataPoints(
    metricID: string,
    options?: {
      since?: number
      until?: number
      tags?: Record<string, string>
    },
  ): Promise<DataPoint[]> {
    const keys = await Storage.list(["timeseries", metricID])
    const points: DataPoint[] = []
    
    for (const key of keys) {
      const point = await Storage.read<DataPoint>(key)
      
      // Filter by time range
      if (options?.since && point.timestamp < options.since) continue
      if (options?.until && point.timestamp > options.until) continue
      
      // Filter by tags
      if (options?.tags) {
        const matchesTags = Object.entries(options.tags).every(
          ([k, v]) => point.tags?.[k] === v,
        )
        if (!matchesTags) continue
      }
      
      points.push(point)
    }
    
    return points.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Get aggregated statistics for a metric by time period.
   * 
   * @param metricID - The metric ID
   * @param options - Aggregation options
   * @returns Array of aggregates per period
   * 
   * @example
   * ```typescript
   * // Get daily stats for last month
   * const dailyStats = await TimeSeries.getAggregates("cost", {
   *   period: "day",
   *   since: Date.now() - 30 * 24 * 60 * 60 * 1000
   * })
   * ```
   */
  export async function getAggregates(
    metricID: string,
    options: {
      period: "hour" | "day" | "week" | "month"
      since?: number
      until?: number
      tags?: Record<string, string>
    },
  ): Promise<Aggregate[]> {
    const points = await getDataPoints(metricID, {
      since: options.since,
      until: options.until,
      tags: options.tags,
    })
    
    if (points.length === 0) {
      return []
    }
    
    // Group by period
    const periodMs = getPeriodMilliseconds(options.period)
    const groups = new Map<number, DataPoint[]>()
    
    for (const point of points) {
      const periodStart = Math.floor(point.timestamp / periodMs) * periodMs
      if (!groups.has(periodStart)) {
        groups.set(periodStart, [])
      }
      groups.get(periodStart)!.push(point)
    }
    
    // Compute aggregates for each period
    const aggregates: Aggregate[] = []
    
    for (const [periodStart, groupPoints] of groups.entries()) {
      const values = groupPoints.map((p) => p.value).sort((a, b) => a - b)
      const count = values.length
      
      if (count === 0) continue
      
      const mean = values.reduce((sum, v) => sum + v, 0) / count
      const median = values[Math.floor(count / 2)]
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count
      const stdDev = Math.sqrt(variance)
      
      aggregates.push({
        metricID,
        period: options.period,
        periodStart,
        periodEnd: periodStart + periodMs,
        count,
        mean,
        median,
        min: values[0],
        max: values[count - 1],
        stdDev,
        p50: values[Math.floor(count * 0.5)],
        p95: values[Math.floor(count * 0.95)],
        p99: values[Math.floor(count * 0.99)],
      })
    }
    
    return aggregates.sort((a, b) => a.periodStart - b.periodStart)
  }

  /**
   * Analyze trend for a metric over a time period.
   * 
   * Performs linear regression and anomaly detection to characterize
   * the metric's behavior over time.
   * 
   * @param metricID - The metric ID
   * @param options - Analysis options
   * @returns Trend analysis with direction, strength, and anomalies
   * 
   * @example
   * ```typescript
   * const analysis = await TimeSeries.analyzeTrend("error-rate", {
   *   days: 14,
   *   anomalyThreshold: 3 // 3 sigma
   * })
   * 
   * if (analysis.trend === "degrading" && analysis.trendStrength > 0.5) {
   *   alert("Strong degradation detected!")
   * }
   * ```
   */
  export async function analyzeTrend(
    metricID: string,
    options: {
      days?: number
      since?: number
      until?: number
      anomalyThreshold?: number // Sigma threshold for anomaly detection
      skipQualityCheck?: boolean // Skip data quality checks (for testing)
    },
  ): Promise<TrendAnalysis> {
    const { Metric } = await import("./metric")
    const metric = await Metric.get(metricID)
    
    // Determine time range
    const end = options.until || Date.now()
    const days = options.days || 7
    const start = options.since || end - days * 24 * 60 * 60 * 1000
    
    // Check data quality first (unless explicitly skipped)
    if (!options.skipQualityCheck) {
      const quality = await checkDataQuality(metricID, { since: start, until: end })
      
      if (quality.totalPoints === 0) {
        throw new Error(`No data points available for trend analysis`)
      }
      
      if (quality.warnings.length > 0) {
        console.warn(
          `[TimeSeries] Data quality issues for ${metricID}:\n` +
          quality.warnings.map(w => `  - ${w}`).join('\n')
        )
      }
    }
    
    // Get data points
    const points = await getDataPoints(metricID, { since: start, until: end })
    
    if (points.length < 3) {
      throw new Error(`Not enough data points for trend analysis (need at least 3, got ${points.length})`)
    }
    
    // Normalize timestamps to days from start
    const values = points.map((p) => p.value)
    const times = points.map((p) => (p.timestamp - start) / (24 * 60 * 60 * 1000))
    
    // Linear regression
    const n = values.length
    const sumX = times.reduce((sum, t) => sum + t, 0)
    const sumY = values.reduce((sum, v) => sum + v, 0)
    const sumXY = times.reduce((sum, t, i) => sum + t * values[i], 0)
    const sumXX = times.reduce((sum, t) => sum + t * t, 0)
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n
    
    // Correlation coefficient
    const meanX = sumX / n
    const meanY = sumY / n
    const numerator = times.reduce((sum, t, i) => sum + (t - meanX) * (values[i] - meanY), 0)
    const denomX = Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - meanX, 2), 0))
    const denomY = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - meanY, 2), 0))
    const correlation = numerator / (denomX * denomY)
    
    // Determine trend direction based on correlation strength
    let trend: "improving" | "degrading" | "stable"
    const trendStrength = Math.abs(correlation)
    
    // Use correlation threshold to determine if trend is significant
    // Correlation > 0.5 indicates moderate to strong linear trend
    if (trendStrength < 0.5) {
      trend = "stable"
    } else {
      const isIncreasing = slope > 0
      trend = (metric.higherIsBetter && isIncreasing) || (!metric.higherIsBetter && !isIncreasing)
        ? "improving"
        : "degrading"
    }
    
    // Anomaly detection using z-score
    const mean = meanY
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n
    const stdDev = Math.sqrt(variance)
    const anomalyThreshold = options.anomalyThreshold || 3
    
    const anomalies = []
    for (let i = 0; i < points.length; i++) {
      const expectedValue = intercept + slope * times[i]
      const deviation = values[i] - expectedValue
      const zScore = stdDev === 0 ? 0 : deviation / stdDev
      
      if (Math.abs(zScore) > anomalyThreshold) {
        anomalies.push({
          timestamp: points[i].timestamp,
          value: values[i],
          expectedValue,
          deviationSigmas: zScore,
        })
      }
    }
    
    // Calculate percent change from start to end
    const startValue = intercept
    const endValue = intercept + slope * days
    const changePercent = startValue === 0 ? 0 : ((endValue - startValue) / startValue) * 100
    
    return {
      metricID,
      period: {
        start,
        end,
        days,
      },
      trend,
      trendStrength,
      slope,
      correlation,
      dataPoints: points.length,
      mean,
      changePercent,
      anomalies,
    }
  }

  /**
   * Detect if current metric value is an anomaly compared to historical data.
   * 
   * @param metricID - The metric ID
   * @param currentValue - The current value to check
   * @param lookbackDays - Days of history to compare against
   * @returns Whether value is anomalous and details
   */
  export async function detectAnomaly(
    metricID: string,
    currentValue: number,
    lookbackDays = 7,
  ): Promise<{
    isAnomaly: boolean
    zScore: number
    expectedRange: { min: number; max: number }
    historicalMean: number
    historicalStdDev: number
  }> {
    const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000
    const points = await getDataPoints(metricID, { since })
    
    if (points.length < 3) {
      return {
        isAnomaly: false,
        zScore: 0,
        expectedRange: { min: currentValue, max: currentValue },
        historicalMean: currentValue,
        historicalStdDev: 0,
      }
    }
    
    const values = points.map((p) => p.value)
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    const stdDev = Math.sqrt(variance)
    
    // Handle edge case where all values are identical (stdDev = 0)
    // If current value differs significantly from mean, it's an anomaly
    let zScore = 0
    let isAnomaly = false
    
    if (stdDev === 0) {
      // All historical values are identical
      const deviation = Math.abs(currentValue - mean)
      // If deviation is more than 10% of mean (or > 0.01 for small values), it's anomalous
      isAnomaly = deviation > Math.max(mean * 0.1, 0.01)
      zScore = isAnomaly ? 10 : 0 // Arbitrary large z-score
    } else {
      zScore = (currentValue - mean) / stdDev
      isAnomaly = Math.abs(zScore) > 3 // 3-sigma rule
    }
    
    return {
      isAnomaly,
      zScore,
      expectedRange: {
        min: mean - 3 * stdDev,
        max: mean + 3 * stdDev,
      },
      historicalMean: mean,
      historicalStdDev: stdDev,
    }
  }

  /**
   * Clear all time-series data for a specific metric.
   * Useful for testing and data cleanup.
   * 
   * @param metricID - The metric ID to clear data for
   */
  export async function clearMetric(metricID: string): Promise<void> {
    const prefix = ["timeseries", metricID]
    const keys = await Storage.list(prefix)
    
    for (const key of keys) {
      await Storage.remove(key)
    }
  }

  /**
   * Data quality report for a metric's time-series data.
   */
  export interface DataQualityReport {
    totalPoints: number
    timeRange: {
      start: number
      end: number
      durationDays: number
    }
    gaps: Array<{
      start: number
      end: number
      durationHours: number
    }>
    duplicates: number
    outOfOrderPoints: number
    warnings: string[]
  }

  /**
   * Analyze data quality for a metric.
   * Helps identify issues before they cause analysis failures.
   * 
   * @param metricID - The metric ID
   * @param options - Query options
   * @returns Data quality report with warnings
   * 
   * @example
   * ```typescript
   * const quality = await TimeSeries.checkDataQuality("cost-metric")
   * if (quality.warnings.length > 0) {
   *   console.warn("Data issues:", quality.warnings)
   * }
   * ```
   */
  export async function checkDataQuality(
    metricID: string,
    options?: { since?: number; until?: number }
  ): Promise<DataQualityReport> {
    const points = await getDataPoints(metricID, options)

    if (points.length === 0) {
      return {
        totalPoints: 0,
        timeRange: { start: 0, end: 0, durationDays: 0 },
        gaps: [],
        duplicates: 0,
        outOfOrderPoints: 0,
        warnings: ["No data points found"],
      }
    }

    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp)
    const start = sorted[0].timestamp
    const end = sorted[sorted.length - 1].timestamp
    const durationDays = (end - start) / (24 * 60 * 60 * 1000)

    // Detect gaps (> 2 hours between points)
    const gaps: DataQualityReport["gaps"] = []
    for (let i = 1; i < sorted.length; i++) {
      const gapMs = sorted[i].timestamp - sorted[i - 1].timestamp
      const gapHours = gapMs / (60 * 60 * 1000)
      if (gapHours > 2) {
        gaps.push({
          start: sorted[i - 1].timestamp,
          end: sorted[i].timestamp,
          durationHours: gapHours,
        })
      }
    }

    // Detect duplicates (same timestamp)
    const timestamps = new Set()
    let duplicates = 0
    for (const point of points) {
      if (timestamps.has(point.timestamp)) {
        duplicates++
      }
      timestamps.add(point.timestamp)
    }

    // Detect out-of-order points (from original array)
    let outOfOrderPoints = 0
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].timestamp > points[i + 1].timestamp) {
        outOfOrderPoints++
      }
    }

    // Generate warnings
    const warnings: string[] = []
    if (points.length < 10) {
      warnings.push(
        `Only ${points.length} data points - need more for reliable analysis`
      )
    }
    if (durationDays < 1) {
      warnings.push(
        `Data spans only ${durationDays.toFixed(1)} days - trends may not be reliable`
      )
    }
    if (gaps.length > 0) {
      const largestGap = Math.max(...gaps.map((g) => g.durationHours))
      warnings.push(
        `${gaps.length} data gaps detected (largest: ${largestGap.toFixed(1)}h) - may affect trend analysis`
      )
    }
    if (duplicates > 0) {
      warnings.push(`${duplicates} duplicate timestamps - may skew statistics`)
    }
    if (outOfOrderPoints > 0) {
      warnings.push(
        `${outOfOrderPoints} out-of-order points - data may be corrupted`
      )
    }

    return {
      totalPoints: points.length,
      timeRange: { start, end, durationDays },
      gaps,
      duplicates,
      outOfOrderPoints,
      warnings,
    }
  }

  /**
   * Get period duration in milliseconds.
   */
  function getPeriodMilliseconds(period: "hour" | "day" | "week" | "month"): number {
    switch (period) {
      case "hour":
        return 60 * 60 * 1000
      case "day":
        return 24 * 60 * 60 * 1000
      case "week":
        return 7 * 24 * 60 * 60 * 1000
      case "month":
        return 30 * 24 * 60 * 60 * 1000
    }
  }
}
