import type { Trace } from "../trace"

/**
 * A heuristic function that evaluates a trace and returns a numeric score.
 * 
 * @param trace - The completed trace to evaluate
 * @param params - Optional parameters for the heuristic function
 * @returns A numeric score representing the evaluation result
 */
export type HeuristicFunction = (trace: Trace.Complete, params?: Record<string, any>) => number

/**
 * Built-in heuristic functions for trace evaluation.
 * 
 * Each function analyzes different aspects of trace execution:
 * - Performance: responseDuration, averageToolDuration, slowToolCalls
 * - Reliability: toolErrorRate, toolSuccessRate, hasErrors
 * - Efficiency: costEfficiency, tokenEfficiency, cacheHitRate
 * - Usage: toolCallCount, toolUsageCount, redundantCalls
 * - Cost: totalCost
 * 
 * @example
 * ```typescript
 * const errorRate = Heuristics.toolErrorRate(trace)
 * const slowCalls = Heuristics.slowToolCalls(trace, { threshold: 3000 })
 * ```
 */
export const Heuristics = {
  /**
   * Calculate the ratio of failed tool calls.
   * 
   * Returns the proportion of tool calls that ended in error status.
   * Useful for measuring reliability and detecting integration issues.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Error rate between 0 (no errors) and 1 (all errors)
   * 
   * @example
   * ```typescript
   * const errorRate = Heuristics.toolErrorRate(trace)
   * // 0.25 means 25% of tool calls failed
   * ```
   */
  toolErrorRate(trace: Trace.Complete, _params?: Record<string, any>): number {
    if (trace.toolCalls.length === 0) return 0
    const errors = trace.toolCalls.filter((t) => t.status === "error").length
    return errors / trace.toolCalls.length
  },

  /**
   * Calculate the total duration in milliseconds.
   * 
   * Measures the end-to-end execution time of the trace from start to finish.
   * Lower values indicate better performance.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Duration in milliseconds
   * 
   * @example
   * ```typescript
   * const duration = Heuristics.responseDuration(trace)
   * // 1500 means the trace took 1.5 seconds
   * ```
   */
  responseDuration(trace: Trace.Complete, _params?: Record<string, any>): number {
    return trace.summary.duration
  },

  /**
   * Detect redundant or duplicate tool calls.
   * 
   * Identifies tools that were called multiple times with the same parameters,
   * which may indicate inefficient agent behavior or retry logic.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Count of tools that were called more than once with identical parameters
   * 
   * @example
   * ```typescript
   * const redundant = Heuristics.redundantCalls(trace)
   * // 2 means two different tools were called redundantly
   * ```
   */
  redundantCalls(trace: Trace.Complete, _params?: Record<string, any>): number {
    const seen = new Map<string, number>()
    
    for (const call of trace.toolCalls) {
      // Create a key from tool ID and params
      const key = `${call.id}:${JSON.stringify(call.extra || {})}`
      seen.set(key, (seen.get(key) || 0) + 1)
    }
    
    // Count how many tools were called multiple times
    return Array.from(seen.values()).filter((count) => count > 1).length
  },

  /**
   * Calculate cost efficiency (cost per successful operation).
   * 
   * Measures how much each successful tool call costs on average.
   * Lower values indicate better cost efficiency.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Cost per successful operation in dollars, or Infinity if no successful calls
   * 
   * @example
   * ```typescript
   * const efficiency = Heuristics.costEfficiency(trace)
   * // 0.01 means each successful operation costs $0.01 on average
   * ```
   */
  costEfficiency(trace: Trace.Complete, _params?: Record<string, any>): number {
    const successfulCalls = trace.toolCalls.filter((t) => t.status === "success").length
    if (successfulCalls === 0) return Infinity
    return trace.summary.cost / successfulCalls
  },

  /**
   * Calculate token efficiency (output tokens / total tokens).
   * 
   * Measures the ratio of output tokens to total tokens used.
   * Higher values indicate more productive token usage.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Ratio between 0 and 1 representing output token efficiency
   * 
   * @example
   * ```typescript
   * const efficiency = Heuristics.tokenEfficiency(trace)
   * // 0.33 means 33% of tokens were output (rest were input/reasoning)
   * ```
   */
  tokenEfficiency(trace: Trace.Complete, _params?: Record<string, any>): number {
    const total =
      trace.summary.tokens.input +
      trace.summary.tokens.output +
      trace.summary.tokens.reasoning
    if (total === 0) return 0
    return trace.summary.tokens.output / total
  },

  /**
   * Calculate average tool call duration.
   * 
   * Computes the mean execution time across all tool calls.
   * Useful for understanding overall tool performance.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Average duration in milliseconds, or 0 if no tool calls
   * 
   * @example
   * ```typescript
   * const avgDuration = Heuristics.averageToolDuration(trace)
   * // 250 means tool calls took 250ms on average
   * ```
   */
  averageToolDuration(trace: Trace.Complete, _params?: Record<string, any>): number {
    if (trace.toolCalls.length === 0) return 0
    const totalDuration = trace.toolCalls.reduce((sum, call) => sum + call.duration, 0)
    return totalDuration / trace.toolCalls.length
  },

  /**
   * Check if any tool call exceeded a duration threshold.
   * 
   * Counts the number of tool calls that took longer than the specified threshold.
   * Useful for identifying performance bottlenecks.
   * 
   * @param trace - The trace to analyze
   * @param params - Configuration object
   * @param params.threshold - Maximum acceptable duration in milliseconds (default: 5000)
   * @returns Count of tool calls exceeding the threshold
   * 
   * @example
   * ```typescript
   * const slow = Heuristics.slowToolCalls(trace, { threshold: 3000 })
   * // 3 means three tool calls took longer than 3 seconds
   * ```
   */
  slowToolCalls(trace: Trace.Complete, params?: { threshold?: number }): number {
    const threshold = params?.threshold ?? 5000 // 5 seconds default
    return trace.toolCalls.filter((t) => t.duration > threshold).length
  },

  /**
   * Calculate the ratio of tool calls that were successful.
   * 
   * Measures the proportion of tool calls that completed successfully.
   * Higher values indicate better reliability.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Success rate between 0 (all failed) and 1 (all succeeded)
   * 
   * @example
   * ```typescript
   * const successRate = Heuristics.toolSuccessRate(trace)
   * // 0.95 means 95% of tool calls succeeded
   * ```
   */
  toolSuccessRate(trace: Trace.Complete, _params?: Record<string, any>): number {
    if (trace.toolCalls.length === 0) return 1 // No tools = perfect success
    const successes = trace.toolCalls.filter((t) => t.status === "success").length
    return successes / trace.toolCalls.length
  },

  /**
   * Count total number of tool calls.
   * 
   * Returns the total number of tool invocations in the trace.
   * Useful for monitoring agent activity levels.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Total count of tool calls
   * 
   * @example
   * ```typescript
   * const count = Heuristics.toolCallCount(trace)
   * // 7 means the agent made 7 tool calls
   * ```
   */
  toolCallCount(trace: Trace.Complete, _params?: Record<string, any>): number {
    return trace.toolCalls.length
  },

  /**
   * Calculate cache hit rate.
   * 
   * Measures the proportion of input tokens that were served from cache.
   * Higher values indicate better cache utilization and cost savings.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Cache hit rate between 0 (no cache hits) and 1 (all from cache)
   * 
   * @example
   * ```typescript
   * const hitRate = Heuristics.cacheHitRate(trace)
   * // 0.4 means 40% of input tokens came from cache
   * ```
   */
  cacheHitRate(trace: Trace.Complete, _params?: Record<string, any>): number {
    const cacheRead = trace.summary.tokens.cache.read
    const totalInput = trace.summary.tokens.input + cacheRead
    if (totalInput === 0) return 0
    return cacheRead / totalInput
  },

  /**
   * Calculate total cost.
   * 
   * Returns the total monetary cost of the trace execution.
   * Includes all LLM API calls and token usage.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns Total cost in dollars
   * 
   * @example
   * ```typescript
   * const cost = Heuristics.totalCost(trace)
   * // 0.02 means the trace cost $0.02 to execute
   * ```
   */
  totalCost(trace: Trace.Complete, _params?: Record<string, any>): number {
    return trace.summary.cost
  },

  /**
   * Check if trace has any errors.
   * 
   * Returns a binary indicator of whether the trace encountered any errors.
   * Useful for pass/fail quality gates.
   * 
   * @param trace - The trace to analyze
   * @param _params - Unused, present for signature consistency
   * @returns 1 if errors occurred, 0 if no errors
   * 
   * @example
   * ```typescript
   * const hasErrors = Heuristics.hasErrors(trace)
   * // 0 means the trace executed without errors
   * ```
   */
  hasErrors(trace: Trace.Complete, _params?: Record<string, any>): number {
    return trace.summary.errorCount > 0 ? 1 : 0
  },

  /**
   * Count specific tool usage.
   * 
   * Counts how many times a particular tool was invoked during trace execution.
   * Useful for monitoring tool usage patterns and detecting overuse.
   * 
   * @param trace - The trace to analyze
   * @param params - Configuration object
   * @param params.toolId - The ID of the tool to count
   * @returns Number of times the specified tool was called (0 if toolId not provided)
   * 
   * @example
   * ```typescript
   * const readCount = Heuristics.toolUsageCount(trace, { toolId: "Read" })
   * // 5 means the Read tool was called 5 times
   * ```
   */
  toolUsageCount(trace: Trace.Complete, params?: { toolId?: string }): number {
    if (!params?.toolId) return 0
    return trace.toolCalls.filter((t) => t.id === params.toolId).length
  },
} as const

export type HeuristicName = keyof typeof Heuristics
