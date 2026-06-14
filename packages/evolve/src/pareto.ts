import type { EvalResult } from "./types.ts"

/**
 * A point in objective space. We maximize `score` and `passRate`, and minimize
 * `sizeBytes` — a smaller skill that scores as well is strictly preferable
 * (GEPA enforces tight size budgets).
 */
export interface ParetoPoint {
  id: string
  score: number
  passRate: number
  sizeBytes: number
}

export function pointFromEval(result: EvalResult): ParetoPoint {
  return {
    id: result.candidateId,
    score: result.objectives.score,
    passRate: result.objectives.passRate,
    sizeBytes: result.objectives.sizeBytes,
  }
}

/** True when `a` dominates `b`: no worse on every objective, better on one. */
export function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  const noWorse = a.score >= b.score && a.passRate >= b.passRate && a.sizeBytes <= b.sizeBytes
  const strictlyBetter = a.score > b.score || a.passRate > b.passRate || a.sizeBytes < b.sizeBytes
  return noWorse && strictlyBetter
}

/** The non-dominated subset (the Pareto frontier). */
export function paretoFront(points: ParetoPoint[]): ParetoPoint[] {
  return points.filter((p) => !points.some((q) => q.id !== p.id && dominates(q, p)))
}

/**
 * Pick the single "best" point for reporting/selection: highest score, breaking
 * ties by pass rate, then by smaller size.
 */
export function selectBest(points: ParetoPoint[]): ParetoPoint | undefined {
  return points
    .slice()
    .sort((a, b) => b.score - a.score || b.passRate - a.passRate || a.sizeBytes - b.sizeBytes)[0]
}
