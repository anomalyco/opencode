import { Effect, Schema } from "effect"
import {
  BenchmarkEntry as BenchmarkEntrySchema,
  SelectionRequest as SelectionRequestSchema,
  SelectionResult as SelectionResultSchema,
  TierWeights as TierWeightsSchema,
  AllTierWeights as AllTierWeightsSchema,
} from "./types"
import { calculateEffectiveCost } from "./cost"

type BenchmarkEntry = Schema.Schema.Type<typeof BenchmarkEntrySchema>
type SelectionRequest = Schema.Schema.Type<typeof SelectionRequestSchema>
type SelectionResult = Schema.Schema.Type<typeof SelectionResultSchema>
type TierWeights = Schema.Schema.Type<typeof TierWeightsSchema>
type AllTierWeights = Schema.Schema.Type<typeof AllTierWeightsSchema>

interface CostInfo {
  readonly is_free: boolean
  readonly output_per_1m: number
}

interface DimensionScores {
  readonly coding_accuracy: number
  readonly reasoning: number
  readonly speed: number
  readonly cost_efficiency: number
}

type ScoreDimension = keyof DimensionScores

const TIER_WEIGHTS: AllTierWeights = {
  low: { coding_accuracy: 0.20, reasoning: 0.10, speed: 0.60, cost_efficiency: 0.10 },
  medium: { coding_accuracy: 0.35, reasoning: 0.25, speed: 0.20, cost_efficiency: 0.20 },
  high: { coding_accuracy: 0.45, reasoning: 0.35, speed: 0.10, cost_efficiency: 0.10 },
}

const TASK_BONUS_DIMENSIONS: Record<string, readonly ScoreDimension[]> = {
  coding: ["coding_accuracy"],
  reasoning: ["reasoning"],
  exploration: ["speed", "cost_efficiency"],
  architecture: ["reasoning", "coding_accuracy"],
  debugging: ["coding_accuracy", "reasoning"],
  review: ["reasoning", "coding_accuracy"],
  general: [],
}

function normalize(values: readonly number[]): number[] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 50)
  return values.map((v) => ((v - min) / (max - min)) * 100)
}

function computeRawScores(
  candidates: Map<string, BenchmarkEntry>,
  effectiveCosts: Map<string, CostInfo>,
): Map<string, DimensionScores> {
  const scores = new Map<string, DimensionScores>()

  for (const [key, entry] of candidates) {
    const b = entry.benchmarks
    const coding_accuracy = (b.swe_bench_verified + b.human_eval + b.mbpp) / 3
    const reasoning = (b.mmlu + b.gpqa_diamond) / 2
    const speed = entry.speed.output_tokens_per_sec

    const cost = effectiveCosts.get(key)
    const cost_efficiency = !cost
      ? 0
      : cost.is_free
        ? 100
        : coding_accuracy / cost.output_per_1m

    scores.set(key, { coding_accuracy, reasoning, speed, cost_efficiency })
  }

  return scores
}

function applyTaskBonus(
  weights: TierWeights,
  taskType: string | undefined,
): TierWeights {
  const dimensions = TASK_BONUS_DIMENSIONS[taskType ?? "general"]
  if (!dimensions || dimensions.length === 0) return weights

  const boosted = { ...weights }
  for (const dim of dimensions) {
    boosted[dim] = boosted[dim] * 1.3
  }

  const total =
    boosted.coding_accuracy +
    boosted.reasoning +
    boosted.speed +
    boosted.cost_efficiency

  return {
    coding_accuracy: boosted.coding_accuracy / total,
    reasoning: boosted.reasoning / total,
    speed: boosted.speed / total,
    cost_efficiency: boosted.cost_efficiency / total,
  }
}

function generateReason(
  entry: BenchmarkEntry,
  cost: CostInfo | undefined,
  score: number,
): string {
  const parts: string[] = []
  const b = entry.benchmarks

  if (b.swe_bench_verified >= 75) {
    parts.push(`${entry.name}: ${b.swe_bench_verified.toFixed(1)}% SWE-bench`)
  } else if (b.human_eval >= 93) {
    parts.push(`${entry.name}: ${b.human_eval.toFixed(1)}% HumanEval`)
  } else {
    parts.push(`${entry.name}: ${score.toFixed(1)} composite score`)
  }

  if (cost?.is_free) {
    parts.push("free")
  } else if (cost && cost.output_per_1m > 0 && cost.output_per_1m <= 1) {
    parts.push(`$${cost.output_per_1m.toFixed(2)}/1M output`)
  }

  return parts.join(", ")
}

export const getDefaultTierWeights = (): AllTierWeights => ({ ...TIER_WEIGHTS })

export const selectModel = Effect.fn("ModelIntelligence.selectModel")(
  function* (
    candidates: Map<string, BenchmarkEntry>,
    request: SelectionRequest,
    effectiveCosts: Map<string, CostInfo>,
  ): SelectionResult {
    if (candidates.size === 0) {
      return {
        provider_id: "",
        model_id: "",
        score: 0,
        reason: "No candidate models available",
        tier: request.tier,
        effective_cost: "unknown",
      }
    }

    const rawScores = computeRawScores(candidates, effectiveCosts)
    const keys = [...candidates.keys()]

    const codingAccValues = keys.map((k) => rawScores.get(k)!.coding_accuracy)
    const reasoningValues = keys.map((k) => rawScores.get(k)!.reasoning)
    const speedValues = keys.map((k) => rawScores.get(k)!.speed)
    const costEffValues = keys.map((k) => rawScores.get(k)!.cost_efficiency)

    const normCodingAcc = normalize(codingAccValues)
    const normReasoning = normalize(reasoningValues)
    const normSpeed = normalize(speedValues)
    const normCostEff = normalize(costEffValues)

    const baseWeights = TIER_WEIGHTS[request.tier]
    const weights = applyTaskBonus(baseWeights, request.task_type)

    let bestKey = keys[0]
    let bestScore = -Infinity

    for (let i = 0; i < keys.length; i++) {
      const composite =
        weights.coding_accuracy * normCodingAcc[i] +
        weights.reasoning * normReasoning[i] +
        weights.speed * normSpeed[i] +
        weights.cost_efficiency * normCostEff[i]

      if (composite > bestScore) {
        bestScore = composite
        bestKey = keys[i]
      }
    }

    const bestEntry = candidates.get(bestKey)!
    const bestCost = effectiveCosts.get(bestKey)

    const costLabel = bestCost?.is_free
      ? "free"
      : bestCost
        ? `$${bestCost.output_per_1m.toFixed(2)}/1M`
        : "unknown"

    return {
      provider_id: bestEntry.provider,
      model_id: bestEntry.id,
      score: Math.round(bestScore * 100) / 100,
      reason: generateReason(bestEntry, bestCost, bestScore),
      tier: request.tier,
      effective_cost: costLabel,
    }
  },
)
