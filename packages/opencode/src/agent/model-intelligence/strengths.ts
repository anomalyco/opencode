import type { TierWeights, BenchmarkEntry, TaskType } from "./types"

const TASK_TYPE_ADJUSTMENTS: Record<string, Partial<TierWeights>> = {
  coding: { coding_accuracy: 1.3 },
  reasoning: { reasoning: 1.3 },
  exploration: { speed: 1.3, cost_efficiency: 1.3 },
  architecture: { reasoning: 1.2, coding_accuracy: 1.1 },
  debugging: { coding_accuracy: 1.2, reasoning: 1.1 },
  review: { reasoning: 1.2, coding_accuracy: 1.1 },
  general: {},
}

export function getTaskTypeAdjustment(taskType: TaskType | undefined): Partial<TierWeights> {
  if (!taskType) return {}
  return TASK_TYPE_ADJUSTMENTS[taskType] ?? {}
}

export function describeModelStrengths(entry: BenchmarkEntry): string[] {
  const descriptions: string[] = []
  const b = entry.benchmarks
  const s = entry.speed
  const c = entry.cost

  if (b.swe_bench_verified > 75) {
    descriptions.push(`Strong real-world coding (${b.swe_bench_verified}% SWE-bench)`)
  }
  if (b.human_eval > 95) {
    descriptions.push(`Excellent code generation (${b.human_eval}% HumanEval)`)
  }
  if (b.mmlu > 88) {
    descriptions.push(`Strong reasoning ability (${b.mmlu}% MMLU)`)
  }
  if (s.output_tokens_per_sec > 120) {
    descriptions.push(`Fast response (${s.output_tokens_per_sec} tok/s)`)
  }
  if (c.input_per_1m === 0 && c.output_per_1m === 0) {
    descriptions.push("Free to use")
  }
  if (b.gpqa_diamond > 55) {
    descriptions.push(`Expert-level reasoning (${b.gpqa_diamond}% GPQA Diamond)`)
  }
  if (entry.capabilities.context_window >= 128000) {
    descriptions.push(`Large context window (${(entry.capabilities.context_window / 1000).toFixed(0)}k tokens)`)
  }
  if (entry.capabilities.vision) {
    descriptions.push("Vision support")
  }

  return descriptions.slice(0, 4)
}

export function getModelProfile(entry: BenchmarkEntry): { bestFor: string[]; avoidFor: string[] } {
  return {
    bestFor: [...entry.strengths],
    avoidFor: [...entry.weaknesses],
  }
}
