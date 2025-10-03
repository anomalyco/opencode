import z from "zod/v4"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import type { Trace } from "../trace"
import type { Metric } from "./metric"
import { Heuristics } from "./heuristics"
import { Log } from "../util/log"

/**
 * EvaluationEngine executes metric evaluations against traces.
 * 
 * Supports three types of evaluators:
 * - Rule: JavaScript expressions evaluated against trace data
 * - Heuristic: Built-in functions for common metrics
 * - LLM: AI-based evaluation using language models (planned)
 * 
 * @example
 * ```typescript
 * const metric = await Metric.get("error-rate")
 * const result = await EvaluationEngine.evaluate(trace, metric)
 * console.log(`Score: ${result.score}, Passed: ${result.passed}`)
 * ```
 */
export namespace EvaluationEngine {
  const log = Log.create({ service: "evaluation-engine" })

  export const Result = z.object({
    id: z.string(),
    traceID: z.string(),
    metricID: z.string(),
    
    score: z.number(),
    passed: z.boolean(),
    
    evaluatorType: z.enum(["rule", "heuristic", "llm"]),
    reasoning: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    
    timestamp: z.number(),
  })
  export type Result = z.infer<typeof Result>

  export const Event = {
    Completed: Bus.event(
      "evaluation.completed",
      z.object({
        result: Result,
      }),
    ),
  }

  /**
   * Evaluate a trace against a specific metric.
   * 
   * Computes a score based on the metric's evaluator type and determines
   * whether the trace passes the defined threshold.
   * 
   * @param trace - The completed trace to evaluate
   * @param metric - The metric definition containing evaluation logic and thresholds
   * @returns Evaluation result with score, pass/fail status, and metadata
   * 
   * @example
   * ```typescript
   * const metric = await Metric.get("response-time")
   * const result = await EvaluationEngine.evaluate(trace, metric)
   * if (result.passed) {
   *   console.log(`Passed with score: ${result.score}`)
   * }
   * ```
   */
  export async function evaluate(trace: Trace.Complete, metric: Metric.Definition): Promise<Result> {
    log.debug("evaluating trace", {
      traceID: trace.id,
      metricID: metric.id,
    })

    const score = await computeScore(trace, metric)
    const threshold = metric.threshold?.pass

    let passed = true
    if (threshold !== undefined) {
      passed = metric.higherIsBetter ? score >= threshold : score <= threshold
    }

    const result: Result = {
      id: Date.now().toString() + "-" + Math.random().toString(36).substring(7),
      traceID: trace.id,
      metricID: metric.id,
      score,
      passed,
      evaluatorType: metric.evaluator.type,
      timestamp: Date.now(),
    }

    // Store the result
    await Storage.write(["evaluation", trace.id, result.id], result)

    // Emit event
    Bus.publish(Event.Completed, { result })

    log.debug("evaluation completed", {
      traceID: trace.id,
      metricID: metric.id,
      score,
      passed,
    })

    return result
  }

  /**
   * Evaluate a trace against multiple metrics in parallel.
   * 
   * Efficiently evaluates multiple metrics simultaneously and returns
   * all results. Useful for quality gates and comprehensive assessments.
   * 
   * @param trace - The completed trace to evaluate
   * @param metrics - Array of metric definitions to evaluate
   * @returns Array of evaluation results, one per metric
   * 
   * @example
   * ```typescript
   * const metrics = await Metric.findByTag("production")
   * const results = await EvaluationEngine.evaluateMany(trace, metrics)
   * const allPassed = results.every(r => r.passed)
   * ```
   */
  export async function evaluateMany(
    trace: Trace.Complete,
    metrics: Metric.Definition[],
  ): Promise<Result[]> {
    return Promise.all(metrics.map((m) => evaluate(trace, m)))
  }

  /**
   * Get evaluation results for a trace
   */
  export async function getResults(traceID: string): Promise<Result[]> {
    const keys = await Storage.list(["evaluation", traceID])
    const results: Result[] = []

    for (const key of keys) {
      const result = await Storage.read<Result>(key)
      results.push(result)
    }

    return results.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Get evaluation results for a specific metric across traces
   */
  export async function getResultsForMetric(metricID: string): Promise<Result[]> {
    // This requires scanning all evaluation results
    // In a real implementation, you might want an index
    const allKeys = await Storage.list(["evaluation"])
    const results: Result[] = []

    for (const key of allKeys) {
      const result = await Storage.read<Result>(key)
      if (result.metricID === metricID) {
        results.push(result)
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Compute score for a trace using a metric
   */
  async function computeScore(trace: Trace.Complete, metric: Metric.Definition): Promise<number> {
    switch (metric.evaluator.type) {
      case "rule":
        return evaluateRule(trace, metric.evaluator.expression)
      case "heuristic":
        return evaluateHeuristic(trace, metric.evaluator)
      case "llm":
        return evaluateLLM(trace, metric.evaluator)
    }
  }

  /**
   * Evaluate using a JavaScript rule expression
   */
  function evaluateRule(trace: Trace.Complete, expression: string): number {
    try {
      // Create a safe evaluation context
      const func = new Function("trace", `return ${expression}`)
      const result = func(trace)
      // Convert boolean to number (true -> 1, false -> 0)
      if (typeof result === "boolean") return result ? 1 : 0
      return typeof result === "number" ? result : 0
    } catch (error) {
      log.error("rule evaluation failed", {
        expression,
        error: error instanceof Error ? error.message : String(error),
      })
      return 0
    }
  }

  /**
   * Evaluate using a built-in heuristic function
   */
  function evaluateHeuristic(trace: Trace.Complete, evaluator: Metric.HeuristicEvaluator): number {
    const functionName = evaluator.function as keyof typeof Heuristics
    const heuristic = Heuristics[functionName]
    
    if (!heuristic) {
      log.error("heuristic not found", {
        function: evaluator.function,
      })
      return 0
    }

    try {
      return heuristic(trace, evaluator.params)
    } catch (error) {
      log.error("heuristic evaluation failed", {
        function: evaluator.function,
        error: error instanceof Error ? error.message : String(error),
      })
      return 0
    }
  }

  /**
   * Evaluate using an LLM judge
   * TODO: Implement LLM-based evaluation
   */
  async function evaluateLLM(_trace: Trace.Complete, evaluator: Metric.LLMEvaluator): Promise<number> {
    log.warn("LLM evaluation not yet implemented", {
      model: evaluator.model,
    })
    
    // Placeholder - would call LLM API here
    // const response = await callLLM(evaluator.model, {
    //   prompt: formatPrompt(evaluator.prompt, trace),
    // })
    // const parseFunc = new Function("output", evaluator.parseScore)
    // return parseFunc(response)
    
    return 0
  }

  /**
   * Get summary statistics for evaluation results.
   * 
   * Aggregates all evaluation results for a trace and computes summary
   * statistics including pass/fail counts and average score.
   * 
   * @param traceID - The ID of the trace to summarize
   * @returns Summary object with statistics and full results
   * 
   * @example
   * ```typescript
   * const summary = await EvaluationEngine.summarize("trace-123")
   * console.log(`${summary.passed}/${summary.total} metrics passed`)
   * console.log(`Average score: ${summary.averageScore.toFixed(2)}`)
   * ```
   */
  export async function summarize(traceID: string): Promise<{
    total: number
    passed: number
    failed: number
    averageScore: number
    results: Result[]
  }> {
    const results = await getResults(traceID)
    const passed = results.filter((r) => r.passed).length
    const failed = results.length - passed
    const averageScore =
      results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0

    return {
      total: results.length,
      passed,
      failed,
      averageScore,
      results,
    }
  }
}
