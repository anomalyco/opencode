import { Bus } from "../bus"
import { Log } from "../util/log"
import { Trace } from "../trace"
import { Baseline } from "./baseline"
import { TimeSeries } from "./timeseries"
import { EvaluationEngine } from "./engine"
import { Metric } from "./metric"

/**
 * Integration layer that connects evaluation, baseline tracking, and time-series
 * analysis with the trace lifecycle.
 * 
 * Features:
 * - Automatic evaluation and time-series recording on trace completion
 * - Automatic baseline comparison for registered baselines
 * - Alert generation for regressions and anomalies
 * - Dashboard data aggregation
 * 
 * @example
 * ```typescript
 * // Enable auto-evaluation for all completed traces
 * await EvaluationIntegration.enableAutoEvaluation({
 *   metricIDs: ["error-rate", "latency", "cost"],
 *   recordTimeSeries: true,
 *   checkBaselines: true,
 * })
 * 
 * // Monitor for regressions
 * EvaluationIntegration.onRegression((alert) => {
 *   console.log(`Regression detected: ${alert.metricID}`)
 *   notifyTeam(alert)
 * })
 * ```
 */
export namespace EvaluationIntegration {
  const log = Log.create({ service: "evaluation-integration" })

  export type Config = {
    /** Metrics to automatically evaluate on trace completion */
    metricIDs: string[]
    /** Whether to record results in time-series */
    recordTimeSeries?: boolean
    /** Whether to compare against active baselines */
    checkBaselines?: boolean
    /** Tags to add to time-series data points */
    tags?: Record<string, string>
    /** Whether to emit alerts for anomalies */
    detectAnomalies?: boolean
    /** Anomaly detection threshold (sigma) */
    anomalyThreshold?: number
  }

  export type RegressionAlert = {
    type: "regression"
    traceID: string
    metricID: string
    baselineID: string
    baselineValue: number
    currentValue: number
    delta: number
    percentChange: number
    timestamp: number
  }

  export type AnomalyAlert = {
    type: "anomaly"
    traceID: string
    metricID: string
    currentValue: number
    expectedRange: { min: number; max: number }
    zScore: number
    timestamp: number
  }

  export type ImprovementAlert = {
    type: "improvement"
    traceID: string
    metricID: string
    baselineID: string
    baselineValue: number
    currentValue: number
    delta: number
    percentChange: number
    timestamp: number
  }

  export type Alert = RegressionAlert | AnomalyAlert | ImprovementAlert

  let config: Config | null = null
  let unsubscribe: (() => void) | null = null
  const alertCallbacks = new Set<(alert: Alert) => void>()

  /**
   * Enable automatic evaluation and monitoring.
   * 
   * When enabled, traces will automatically be evaluated against specified
   * metrics, results recorded in time-series, and compared against baselines.
   * 
   * @param cfg - Configuration for auto-evaluation
   */
  export async function enableAutoEvaluation(cfg: Config) {
    if (unsubscribe) {
      log.warn("auto-evaluation already enabled, reconfiguring")
      unsubscribe()
    }

    config = cfg
    log.info("enabling auto-evaluation", { metricIDs: cfg.metricIDs })

    // Subscribe to trace completion events
    unsubscribe = Bus.subscribe(Trace.Event.Completed, async ({ properties }) => {
      try {
        await processTrace(properties.trace, cfg)
      } catch (error) {
        log.error("failed to process trace", { error, traceID: properties.trace.id })
      }
    })
  }

  /**
   * Disable automatic evaluation.
   */
  export function disableAutoEvaluation() {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
      config = null
      log.info("auto-evaluation disabled")
    }
  }

  /**
   * Register a callback for alert notifications.
   * 
   * @param callback - Function to call when alerts are generated
   * @returns Unsubscribe function
   */
  export function onAlert(callback: (alert: Alert) => void): () => void {
    alertCallbacks.add(callback)
    return () => alertCallbacks.delete(callback)
  }

  /**
   * Convenience method for regression-only alerts.
   */
  export function onRegression(callback: (alert: RegressionAlert) => void): () => void {
    return onAlert((alert) => {
      if (alert.type === "regression") callback(alert)
    })
  }

  /**
   * Convenience method for anomaly-only alerts.
   */
  export function onAnomaly(callback: (alert: AnomalyAlert) => void): () => void {
    return onAlert((alert) => {
      if (alert.type === "anomaly") callback(alert)
    })
  }

  /**
   * Convenience method for improvement-only alerts.
   */
  export function onImprovement(callback: (alert: ImprovementAlert) => void): () => void {
    return onAlert((alert) => {
      if (alert.type === "improvement") callback(alert)
    })
  }

  /**
   * Get dashboard data aggregating evaluation results.
   * 
   * @param options - Filtering and aggregation options
   * @returns Dashboard data with metrics, trends, and alerts
   */
  export async function getDashboard(options: {
    since?: number
    until?: number
    metricIDs?: string[]
    period?: "hour" | "day" | "week" | "month"
  }) {
    const metricIDs = options.metricIDs ?? config?.metricIDs ?? []
    const period = options.period ?? "day"

    const metrics = await Promise.all(
      metricIDs.map(async (metricID) => {
        const metric = await Metric.get(metricID)
        
        // Get time-series data
        const points = await TimeSeries.getDataPoints(metricID, {
          since: options.since,
          until: options.until,
        })

        // Get aggregates
        const aggregates = await TimeSeries.getAggregates(metricID, { period })

        // Get trend analysis
        let trend = null
        try {
          const days = options.since 
            ? Math.ceil((Date.now() - options.since) / (24 * 60 * 60 * 1000))
            : 7
          trend = await TimeSeries.analyzeTrend(metricID, { days })
        } catch {
          // Not enough data
        }

        // Get associated baselines
        const baselines = await Baseline.list()
        const relevantBaselines = baselines.filter((b) => b.metricIDs.includes(metricID))

        return {
          metric,
          dataPoints: points.length,
          aggregates: aggregates.slice(-10), // Last 10 periods
          trend,
          baselines: relevantBaselines.map((b) => ({
            id: b.id,
            name: b.name,
            statistics: b.statistics.find((s) => s.metricID === metricID),
          })),
        }
      }),
    )

    return {
      metrics,
      period: {
        start: options.since ?? Date.now() - 7 * 24 * 60 * 60 * 1000,
        end: options.until ?? Date.now(),
      },
    }
  }

  /**
   * Process a completed trace through the evaluation pipeline.
   */
  async function processTrace(trace: Trace.Complete, cfg: Config) {
    log.debug("processing trace", { traceID: trace.id })

    // 1. Evaluate all configured metrics
    const metrics = await Promise.all(cfg.metricIDs.map((id) => Metric.get(id)))
    const results = await EvaluationEngine.evaluateMany(trace, metrics)

    log.debug("evaluated trace", {
      traceID: trace.id,
      resultsCount: results.length,
    })

    // 2. Check for anomalies if enabled (BEFORE recording to time-series)
    if (cfg.detectAnomalies) {
      for (const result of results) {
        try {
          const anomalyResult = await TimeSeries.detectAnomaly(
            result.metricID,
            result.score,
            7, // 7 days lookback
          )

          if (anomalyResult.isAnomaly) {
            const alert: AnomalyAlert = {
              type: "anomaly",
              traceID: trace.id,
              metricID: result.metricID,
              currentValue: result.score,
              expectedRange: anomalyResult.expectedRange,
              zScore: anomalyResult.zScore,
              timestamp: Date.now(),
            }
            emitAlert(alert)
          }
        } catch {
          // Not enough data for anomaly detection
        }
      }
    }

    // 3. Record in time-series if enabled (AFTER anomaly detection)
    if (cfg.recordTimeSeries) {
      for (const result of results) {
        await TimeSeries.record(result.metricID, trace, cfg.tags)
      }
      log.debug("recorded time-series", { traceID: trace.id })
    }

    // 4. Compare against baselines if enabled
    if (cfg.checkBaselines) {
      const baselines = await Baseline.list()
      
      for (const baseline of baselines) {
        // Check if this baseline applies to this trace
        const relevantMetrics = cfg.metricIDs.filter((id) => baseline.metricIDs.includes(id))
        if (relevantMetrics.length === 0) continue

        // Skip if baseline doesn't have enough samples yet
        if (baseline.traceIDs.length < baseline.minSampleSize) continue

        try {
          const comparison = await Baseline.compare(baseline.id, trace)

          // Emit alerts for regressions
          for (const metricID of comparison.regressions) {
            const metricComparison = comparison.metrics.find((m) => m.metricID === metricID)
            if (!metricComparison) continue

            const alert: RegressionAlert = {
              type: "regression",
              traceID: trace.id,
              metricID,
              baselineID: baseline.id,
              baselineValue: metricComparison.baselineValue,
              currentValue: metricComparison.traceValue,
              delta: metricComparison.delta,
              percentChange: metricComparison.percentChange,
              timestamp: Date.now(),
            }
            emitAlert(alert)
          }

          // Emit alerts for improvements
          for (const metricID of comparison.improvements) {
            const metricComparison = comparison.metrics.find((m) => m.metricID === metricID)
            if (!metricComparison) continue

            const alert: ImprovementAlert = {
              type: "improvement",
              traceID: trace.id,
              metricID,
              baselineID: baseline.id,
              baselineValue: metricComparison.baselineValue,
              currentValue: metricComparison.traceValue,
              delta: metricComparison.delta,
              percentChange: metricComparison.percentChange,
              timestamp: Date.now(),
            }
            emitAlert(alert)
          }
        } catch (error) {
          log.error("baseline comparison failed", { error, baselineID: baseline.id })
        }
      }
    }

    log.debug("trace processing complete", { traceID: trace.id })
  }

  /**
   * Emit an alert to all registered callbacks.
   */
  function emitAlert(alert: Alert) {
    log.info("emitting alert", { type: alert.type, traceID: alert.traceID })
    for (const callback of alertCallbacks) {
      try {
        callback(alert)
      } catch (error) {
        log.error("alert callback failed", { error })
      }
    }
  }

  /**
   * Manually trigger evaluation for a specific trace.
   * 
   * Useful for re-evaluating historical traces or evaluating traces
   * that were completed before auto-evaluation was enabled.
   * 
   * @param traceOrID - The trace object or trace ID to evaluate
   * @param cfg - Optional configuration (uses global config if not provided)
   */
  export async function evaluateTrace(traceOrID: string | Trace.Complete, cfg?: Config) {
    const trace = typeof traceOrID === "string" ? await Trace.get(traceOrID) : traceOrID
    const evalConfig = cfg ?? config
    if (!evalConfig) {
      throw new Error("No configuration provided and auto-evaluation not enabled")
    }
    await processTrace(trace, evalConfig)
  }

  /**
   * Batch evaluate multiple traces.
   * 
   * @param tracesOrIDs - Array of trace objects or trace IDs to evaluate
   * @param cfg - Optional configuration
   */
  export async function evaluateTraces(tracesOrIDs: (string | Trace.Complete)[], cfg?: Config) {
    const evalConfig = cfg ?? config
    if (!evalConfig) {
      throw new Error("No configuration provided and auto-evaluation not enabled")
    }

    for (const traceOrID of tracesOrIDs) {
      try {
        await evaluateTrace(traceOrID, evalConfig)
      } catch (error) {
        const id = typeof traceOrID === "string" ? traceOrID : traceOrID.id
        log.error("failed to evaluate trace", { error, traceID: id })
      }
    }
  }
}
