import { BusEvent } from "@/bus/bus-event"
import z from "zod"

/**
 * Benchmark metrics collection for comparing compaction methods.
 * Captures timing, token usage, and outputs for evaluation.
 */
export namespace BenchmarkMetrics {
  /**
   * Metrics captured for a single compaction operation
   */
  export interface CompactionMetrics {
    /** Which compaction method was used */
    method: "hybrid" | "legacy"
    /** Unix timestamp when compaction started */
    timestamp: number
    /** How long compaction took in milliseconds */
    duration_ms: number
    /** Token usage during compaction */
    tokens: {
      input: number
      output: number
      total: number
    }
    /** Token count of context before compaction */
    original_context_tokens: number
    /** Token count of context after compaction */
    compacted_context_tokens: number
    /** Compression ratio (1 - compacted/original) */
    compression_ratio: number
    /** The compaction summary text for LLM judgment */
    output_text: string
  }

  /**
   * Metrics for a complete benchmark run with one compaction method
   */
  export interface RunMetrics {
    /** Unique identifier for this run */
    run_id: string
    /** Name of the benchmark task */
    task: string
    /** Model used for the run */
    model: string
    /** Unix timestamp when run started */
    started_at: number
    /** Unix timestamp when run completed */
    completed_at: number
    /** Total number of compactions that occurred */
    total_compactions: number
    /** Metrics for each compaction */
    compactions: CompactionMetrics[]
    /** Whether the task completed successfully */
    task_completed: boolean
    /** Error message if task failed */
    error?: string
  }

  /**
   * Complete benchmark result comparing both methods
   */
  export interface BenchmarkResult {
    /** Unique identifier for this benchmark */
    benchmark_id: string
    /** Name of the benchmark task */
    task: string
    /** Model used for both runs */
    model: string
    /** Unix timestamp when benchmark started */
    timestamp: number
    /** Metrics from hybrid compaction run */
    hybrid: RunMetrics
    /** Metrics from legacy compaction run */
    legacy: RunMetrics
    /** Comparison statistics */
    comparison: {
      /** Percentage of tokens saved by hybrid vs legacy */
      token_savings_percent: number
      /** Percentage of time saved by hybrid vs legacy */
      time_savings_percent: number
      /** Which method performed better overall */
      winner?: "hybrid" | "legacy" | "tie"
    }
    /** Optional LLM judgment of quality */
    llm_judgment?: {
      winner: "hybrid" | "legacy" | "tie"
      rationale: string
      judged_at: number
    }
  }

  /**
   * Bus event for compaction metrics collection
   */
  export const Event = {
    CompactionMetrics: BusEvent.define(
      "benchmark.compaction.metrics",
      z.object({
        sessionID: z.string(),
        metrics: z.custom<CompactionMetrics>(),
      }),
    ),
  }

  /**
   * Create an empty RunMetrics object
   */
  export function createRunMetrics(options: {
    run_id: string
    task: string
    model: string
  }): RunMetrics {
    return {
      run_id: options.run_id,
      task: options.task,
      model: options.model,
      started_at: Date.now(),
      completed_at: 0,
      total_compactions: 0,
      compactions: [],
      task_completed: false,
    }
  }

  /**
   * Calculate comparison statistics between two runs
   */
  export function compareRuns(hybrid: RunMetrics, legacy: RunMetrics): BenchmarkResult["comparison"] {
    const hybridTotalTokens = hybrid.compactions.reduce((sum, c) => sum + c.tokens.total, 0)
    const legacyTotalTokens = legacy.compactions.reduce((sum, c) => sum + c.tokens.total, 0)

    const hybridTotalTime = hybrid.compactions.reduce((sum, c) => sum + c.duration_ms, 0)
    const legacyTotalTime = legacy.compactions.reduce((sum, c) => sum + c.duration_ms, 0)

    const tokenSavings = legacyTotalTokens > 0
      ? ((legacyTotalTokens - hybridTotalTokens) / legacyTotalTokens) * 100
      : 0

    const timeSavings = legacyTotalTime > 0
      ? ((legacyTotalTime - hybridTotalTime) / legacyTotalTime) * 100
      : 0

    // Determine winner based on token savings (primary) and time (secondary)
    let winner: "hybrid" | "legacy" | "tie" | undefined
    if (Math.abs(tokenSavings) < 5 && Math.abs(timeSavings) < 5) {
      winner = "tie"
    } else if (tokenSavings > 0 || (tokenSavings === 0 && timeSavings > 0)) {
      winner = "hybrid"
    } else {
      winner = "legacy"
    }

    return {
      token_savings_percent: Math.round(tokenSavings * 100) / 100,
      time_savings_percent: Math.round(timeSavings * 100) / 100,
      winner,
    }
  }

  /**
   * Generate a unique benchmark ID
   */
  export function generateBenchmarkId(): string {
    return `benchmark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Generate a unique run ID
   */
  export function generateRunId(method: "hybrid" | "legacy"): string {
    return `run_${method}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}
