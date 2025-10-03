import z from "zod/v4"
import { Storage } from "../storage/storage"

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
   * Register a metric
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
   * Find metrics by category
   */
  export async function findByCategory(category: Category): Promise<Definition[]> {
    const all = await list()
    return all.filter((m) => m.category === category)
  }

  /**
   * Find metrics by tag
   */
  export async function findByTag(tag: string): Promise<Definition[]> {
    const all = await list()
    return all.filter((m) => m.tags.includes(tag))
  }
}
