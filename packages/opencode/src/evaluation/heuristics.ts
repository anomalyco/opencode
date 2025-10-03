import type { Trace } from "../trace"

export type HeuristicFunction = (trace: Trace.Complete, params?: Record<string, any>) => number

/**
 * Built-in heuristic functions for trace evaluation
 */
export const Heuristics: Record<string, HeuristicFunction> = {
  /**
   * Calculate the ratio of failed tool calls
   */
  toolErrorRate(trace: Trace.Complete): number {
    if (trace.toolCalls.length === 0) return 0
    const errors = trace.toolCalls.filter((t) => t.status === "error").length
    return errors / trace.toolCalls.length
  },

  /**
   * Calculate the total duration in milliseconds
   */
  responseDuration(trace: Trace.Complete): number {
    return trace.summary.duration
  },

  /**
   * Detect redundant/duplicate tool calls
   */
  redundantCalls(trace: Trace.Complete): number {
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
   * Calculate cost efficiency (cost per successful operation)
   */
  costEfficiency(trace: Trace.Complete): number {
    const successfulCalls = trace.toolCalls.filter((t) => t.status === "success").length
    if (successfulCalls === 0) return Infinity
    return trace.summary.cost / successfulCalls
  },

  /**
   * Calculate token efficiency (output tokens / total tokens)
   */
  tokenEfficiency(trace: Trace.Complete): number {
    const total =
      trace.summary.tokens.input +
      trace.summary.tokens.output +
      trace.summary.tokens.reasoning
    if (total === 0) return 0
    return trace.summary.tokens.output / total
  },

  /**
   * Calculate average tool call duration
   */
  averageToolDuration(trace: Trace.Complete): number {
    if (trace.toolCalls.length === 0) return 0
    const totalDuration = trace.toolCalls.reduce((sum, call) => sum + call.duration, 0)
    return totalDuration / trace.toolCalls.length
  },

  /**
   * Check if any tool call exceeded a duration threshold
   */
  slowToolCalls(trace: Trace.Complete, params?: { threshold?: number }): number {
    const threshold = params?.threshold ?? 5000 // 5 seconds default
    return trace.toolCalls.filter((t) => t.duration > threshold).length
  },

  /**
   * Calculate the ratio of tool calls that were successful
   */
  toolSuccessRate(trace: Trace.Complete): number {
    if (trace.toolCalls.length === 0) return 1 // No tools = perfect success
    const successes = trace.toolCalls.filter((t) => t.status === "success").length
    return successes / trace.toolCalls.length
  },

  /**
   * Count total number of tool calls
   */
  toolCallCount(trace: Trace.Complete): number {
    return trace.toolCalls.length
  },

  /**
   * Calculate cache hit rate
   */
  cacheHitRate(trace: Trace.Complete): number {
    const cacheRead = trace.summary.tokens.cache.read
    const totalInput = trace.summary.tokens.input + cacheRead
    if (totalInput === 0) return 0
    return cacheRead / totalInput
  },

  /**
   * Calculate total cost
   */
  totalCost(trace: Trace.Complete): number {
    return trace.summary.cost
  },

  /**
   * Check if trace has any errors
   */
  hasErrors(trace: Trace.Complete): number {
    return trace.summary.errorCount > 0 ? 1 : 0
  },

  /**
   * Count specific tool usage
   */
  toolUsageCount(trace: Trace.Complete, params?: { toolId?: string }): number {
    if (!params?.toolId) return 0
    return trace.toolCalls.filter((t) => t.id === params.toolId).length
  },
}
