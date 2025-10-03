import z from "zod/v4"
import { Storage } from "../storage/storage"

/**
 * Metric management for trace evaluation.
 * 
 * Metrics define how traces should be evaluated, including:
 * - What to measure (via evaluator)
 * - Success thresholds (pass/warn values)
 * - Whether higher or lower scores are better
 * 
 * Supports three evaluator types:
 * - Rule: JavaScript expressions for custom logic
 * - Heuristic: Built-in functions for common metrics
 * - LLM: AI-powered evaluation (planned)
 * 
 * @example
 * ```typescript
 * await Metric.register({
 *   id: "error-rate",
 *   name: "Error Rate",
 *   description: "Tool call error rate threshold",
 *   version: "1.0.0",
 *   category: "reliability",
 *   evaluator: { type: "heuristic", function: "toolErrorRate" },
 *   threshold: { pass: 0.05, warn: 0.02 },
 *   higherIsBetter: false,
 *   tags: ["production", "quality-gate"]
 * })
 * ```
 */
export namespace Metric {
  export const Category = z.enum(["performance", "correctness", "safety", "cost", "quality", "reliability"])
  export type Category = z.infer<typeof Category>

  export const RuleEvaluator = z.object({
    type: z.literal("rule"),
    expression: z.string(), // JavaScript expression evaluated against trace
  })
  export type RuleEvaluator = z.infer<typeof RuleEvaluator>

  export const HeuristicEvaluator = z.object({
    type: z.literal("heuristic"),
    function: z.string(), // Name of built-in heuristic function
    params: z.record(z.string(), z.any()).optional(),
  })
  export type HeuristicEvaluator = z.infer<typeof HeuristicEvaluator>

  export const LLMEvaluator = z.object({
    type: z.literal("llm"),
    prompt: z.string(),
    model: z.string(),
    parseScore: z.string(), // Function body to parse LLM output to number
  })
  export type LLMEvaluator = z.infer<typeof LLMEvaluator>

  export const Evaluator = z.discriminatedUnion("type", [
    RuleEvaluator,
    HeuristicEvaluator,
    LLMEvaluator,
  ])
  export type Evaluator = z.infer<typeof Evaluator>

  export const Threshold = z.object({
    pass: z.number(),
    warn: z.number().optional(),
  })
  export type Threshold = z.infer<typeof Threshold>

  export const Definition = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    category: Category,
    evaluator: Evaluator,
    threshold: Threshold.optional(),
    higherIsBetter: z.boolean(),
    tags: z.array(z.string()).default([]),
  })
  export type Definition = z.infer<typeof Definition>

  /**
   * Register a new metric definition.
   * 
   * Stores the metric in the registry for use in evaluations.
   * Metrics can be retrieved by ID, category, or tags.
   * 
   * @param metric - The complete metric definition
   * 
   * @example
   * ```typescript
   * await Metric.register({
   *   id: "cost-limit",
   *   name: "Cost Limit",
   *   description: "Maximum cost per trace",
   *   version: "1.0.0",
   *   category: "cost",
   *   evaluator: { type: "heuristic", function: "totalCost" },
   *   threshold: { pass: 0.10 },
   *   higherIsBetter: false,
   *   tags: ["budget"]
   * })
   * ```
   */
  export async function register(metric: Definition): Promise<void> {
    await Storage.write(["metric", metric.id], metric)
  }

  /**
   * Get a metric by ID
   */
  export async function get(id: string): Promise<Definition> {
    const metric = await Storage.read<Definition>(["metric", id])
    return metric
  }

  /**
   * List all registered metrics
   */
  export async function list(): Promise<Definition[]> {
    const keys = await Storage.list(["metric"])
    const metrics: Definition[] = []
    
    for (const key of keys) {
      const metric = await Storage.read<Definition>(key)
      metrics.push(metric)
    }
    
    return metrics
  }

  /**
   * Check if a metric exists
   */
  export async function exists(id: string): Promise<boolean> {
    try {
      await get(id)
      return true
    } catch {
      return false
    }
  }

  /**
   * Remove a metric
   */
  export async function remove(id: string): Promise<void> {
    await Storage.remove(["metric", id])
  }

  /**
   * Find metrics by category.
   * 
   * Retrieves all metrics that belong to a specific category.
   * Categories help organize metrics by their evaluation focus.
   * 
   * @param category - The category to filter by (performance, correctness, safety, cost, quality, reliability)
   * @returns Array of metric definitions in the specified category
   * 
   * @example
   * ```typescript
   * const costMetrics = await Metric.findByCategory("cost")
   * console.log(`Found ${costMetrics.length} cost metrics`)
   * ```
   */
  export async function findByCategory(category: Category): Promise<Definition[]> {
    const all = await list()
    return all.filter((m) => m.category === category)
  }

  /**
   * Find metrics by tag.
   * 
   * Retrieves all metrics that have a specific tag.
   * Tags allow flexible grouping and filtering of metrics.
   * 
   * @param tag - The tag to filter by
   * @returns Array of metric definitions with the specified tag
   * 
   * @example
   * ```typescript
   * const prodMetrics = await Metric.findByTag("production")
   * const gateMetrics = await Metric.findByTag("quality-gate")
   * ```
   */
  export async function findByTag(tag: string): Promise<Definition[]> {
    const all = await list()
    return all.filter((m) => m.tags.includes(tag))
  }
}
