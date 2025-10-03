/**
 * Metric semantics and validation utilities.
 * 
 * Provides type-safe semantic definitions for common metric types
 * and validation to catch configuration errors early.
 */

import type { Metric } from "./metric"

export namespace MetricSemantics {
  /**
   * Semantic metadata for a metric.
   */
  export interface Semantics {
    unit?: string
    interpretSlope?: (slope: number, higherIsBetter: boolean) => string
    formatValue?: (value: number) => string
  }

  /**
   * Common semantic patterns for standard metric types.
   */
  export const Common = {
    /**
     * Cost metrics (dollars, credits, tokens).
     * Lower is better.
     */
    cost: {
      unit: "dollars",
      interpretSlope: (slope: number) =>
        slope > 0 ? "increasing (worse)" : "decreasing (better)",
      formatValue: (v: number) => `$${v.toFixed(4)}`,
    } as Semantics,

    /**
     * Duration/latency metrics (milliseconds, seconds).
     * Lower is better.
     */
    duration: {
      unit: "milliseconds",
      interpretSlope: (slope: number) =>
        slope > 0 ? "slowing down (worse)" : "speeding up (better)",
      formatValue: (v: number) => {
        if (v < 1000) return `${v.toFixed(0)}ms`
        return `${(v / 1000).toFixed(2)}s`
      },
    } as Semantics,

    /**
     * Error rate metrics (proportion, percentage).
     * Lower is better.
     */
    errorRate: {
      unit: "percent",
      interpretSlope: (slope: number) =>
        slope > 0 ? "more errors (worse)" : "fewer errors (better)",
      formatValue: (v: number) => `${(v * 100).toFixed(1)}%`,
    } as Semantics,

    /**
     * Throughput metrics (requests/second, items/second).
     * Higher is better.
     */
    throughput: {
      unit: "requests/second",
      interpretSlope: (slope: number) =>
        slope > 0 ? "increasing (better)" : "decreasing (worse)",
      formatValue: (v: number) => `${v.toFixed(1)} req/s`,
    } as Semantics,

    /**
     * Quality/accuracy metrics (score, rating).
     * Higher is better.
     */
    quality: {
      unit: "score",
      interpretSlope: (slope: number) =>
        slope > 0 ? "improving (better)" : "degrading (worse)",
      formatValue: (v: number) => v.toFixed(2),
    } as Semantics,

    /**
     * Token count metrics.
     * Context-dependent (lower usually better for cost).
     */
    tokens: {
      unit: "tokens",
      interpretSlope: (slope: number, higherIsBetter: boolean) =>
        higherIsBetter
          ? slope > 0
            ? "increasing (better)"
            : "decreasing (worse)"
          : slope > 0
          ? "increasing (worse)"
          : "decreasing (better)",
      formatValue: (v: number) => `${Math.round(v)} tokens`,
    } as Semantics,
  }

  /**
   * Validation result for a metric definition.
   */
  export interface ValidationResult {
    valid: boolean
    errors: string[]
    warnings: string[]
  }

  /**
   * Validate metric definition for common issues.
   * 
   * Checks for:
   * - Semantic mismatches (cost with higherIsBetter=true)
   * - Missing required fields
   * - Inconsistent configuration
   * 
   * @param metric - The metric definition to validate
   * @returns Validation result with errors and warnings
   * 
   * @example
   * ```typescript
   * const metric: Metric.Definition = {
   *   id: 'cost',
   *   evaluator: { type: 'heuristic', function: 'totalCost' },
   *   higherIsBetter: true,  // WRONG!
   *   semantics: MetricSemantics.Common.cost
   * }
   * 
   * const result = MetricSemantics.validate(metric)
   * // result.errors = ['Cost metrics should have higherIsBetter=false']
   * ```
   */
  export function validate(metric: Metric.Definition): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Check semantic/direction mismatches
    if (metric.semantics?.unit === "dollars" && metric.higherIsBetter) {
      errors.push(
        `Metric "${metric.name}" (${metric.id}): Cost metrics should typically have higherIsBetter=false`
      )
    }

    if (metric.semantics?.unit === "milliseconds" && metric.higherIsBetter) {
      errors.push(
        `Metric "${metric.name}" (${metric.id}): Duration metrics should typically have higherIsBetter=false`
      )
    }

    if (metric.semantics?.unit === "percent" && metric.higherIsBetter) {
      // Percent could be error rate (lower better) or success rate (higher better)
      // Only warn if it's explicitly an error rate
      if (
        metric.name.toLowerCase().includes("error") ||
        metric.id.toLowerCase().includes("error")
      ) {
        errors.push(
          `Metric "${metric.name}" (${metric.id}): Error rate metrics should have higherIsBetter=false`
        )
      }
    }

    if (
      (metric.semantics?.unit === "requests/second" ||
        metric.semantics?.unit === "score") &&
      !metric.higherIsBetter
    ) {
      warnings.push(
        `Metric "${metric.name}" (${metric.id}): ${metric.semantics.unit} metrics usually have higherIsBetter=true`
      )
    }

    // Check for missing metadata
    if (!metric.description) {
      warnings.push(
        `Metric "${metric.name}" (${metric.id}): Missing description - add documentation for clarity`
      )
    }

    if (!metric.semantics) {
      warnings.push(
        `Metric "${metric.name}" (${metric.id}): No semantics defined - consider adding for better formatting`
      )
    }

    // Check category makes sense
    if (metric.category === "cost" && metric.higherIsBetter) {
      errors.push(
        `Metric "${metric.name}" (${metric.id}): Category "cost" implies higherIsBetter=false`
      )
    }

    if (metric.category === "performance" && metric.higherIsBetter === undefined) {
      warnings.push(
        `Metric "${metric.name}" (${metric.id}): Performance metrics should explicitly set higherIsBetter`
      )
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Suggest appropriate semantics based on metric properties.
   * 
   * @param metric - The metric definition
   * @returns Suggested semantics object or null
   * 
   * @example
   * ```typescript
   * const metric = {
   *   id: 'response-time',
   *   category: 'performance',
   *   higherIsBetter: false
   * }
   * 
   * const semantics = MetricSemantics.suggest(metric)
   * // semantics = Common.duration
   * ```
   */
  export function suggest(
    metric: Pick<Metric.Definition, "id" | "name" | "category" | "higherIsBetter">
  ): Semantics | null {
    const name = metric.name?.toLowerCase() || ""
    const id = metric.id.toLowerCase()
    const text = `${name} ${id}`

    // Cost-related
    if (
      metric.category === "cost" ||
      text.includes("cost") ||
      text.includes("price") ||
      text.includes("dollar")
    ) {
      return Common.cost
    }

    // Duration-related
    if (
      text.includes("duration") ||
      text.includes("latency") ||
      text.includes("time") ||
      text.includes("delay")
    ) {
      return Common.duration
    }

    // Error-related
    if (text.includes("error") || text.includes("failure") || text.includes("fail")) {
      return Common.errorRate
    }

    // Throughput-related
    if (
      text.includes("throughput") ||
      text.includes("rate") ||
      text.includes("rps") ||
      text.includes("qps")
    ) {
      return Common.throughput
    }

    // Quality-related
    if (
      text.includes("quality") ||
      text.includes("score") ||
      text.includes("accuracy") ||
      text.includes("precision")
    ) {
      return Common.quality
    }

    // Token-related
    if (text.includes("token")) {
      return Common.tokens
    }

    return null
  }

  /**
   * Format a metric value using its semantics.
   * 
   * @param value - The value to format
   * @param metric - The metric definition (or just semantics)
   * @returns Formatted string
   * 
   * @example
   * ```typescript
   * formatValue(0.0245, { semantics: Common.cost })
   * // "$0.0245"
   * 
   * formatValue(1500, { semantics: Common.duration })
   * // "1.50s"
   * ```
   */
  export function formatValue(
    value: number,
    metric: { semantics?: Semantics }
  ): string {
    if (metric.semantics?.formatValue) {
      return metric.semantics.formatValue(value)
    }

    // Default formatting
    if (Math.abs(value) < 0.01) {
      return value.toExponential(2)
    }
    if (Math.abs(value) < 1) {
      return value.toFixed(4)
    }
    if (Math.abs(value) < 100) {
      return value.toFixed(2)
    }
    return Math.round(value).toString()
  }

  /**
   * Interpret trend direction with semantic context.
   * 
   * @param slope - The slope from trend analysis
   * @param metric - The metric definition
   * @returns Human-readable interpretation
   * 
   * @example
   * ```typescript
   * interpretTrend(0.005, { 
   *   higherIsBetter: false,
   *   semantics: Common.cost 
   * })
   * // "increasing (worse)"
   * ```
   */
  export function interpretTrend(
    slope: number,
    metric: { higherIsBetter: boolean; semantics?: Semantics }
  ): string {
    if (metric.semantics?.interpretSlope) {
      return metric.semantics.interpretSlope(slope, metric.higherIsBetter)
    }

    // Default interpretation
    const direction = slope > 0 ? "increasing" : "decreasing"
    const isGood =
      (slope > 0 && metric.higherIsBetter) ||
      (slope < 0 && !metric.higherIsBetter)
    const quality = isGood ? "better" : "worse"

    return `${direction} (${quality})`
  }
}
