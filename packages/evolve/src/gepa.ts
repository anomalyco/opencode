import type {
  Candidate,
  Dataset,
  EvaluatedCandidate,
  GenerationRecord,
  RunResult,
  Skill,
} from "./types.ts"
import type { LLMClient } from "./llm.ts"
import type { Scorer } from "./evaluate.ts"
import { evaluateCandidate } from "./evaluate.ts"
import { proposeVariants } from "./mutate.ts"
import { runGates, type GateOptions } from "./constraints.ts"
import { paretoFront, pointFromEval, selectBest, type ParetoPoint } from "./pareto.ts"

export interface EvolveConfig extends GateOptions {
  /** Number of generations to run. */
  generations: number
  /** Variants proposed per parent per generation. */
  population: number
  /** Max parents carried forward from the frontier each generation. */
  elitism?: number
  temperature?: number
  passThreshold?: number
  /** Optional progress hook. */
  onGeneration?: (record: GenerationRecord) => void
}

export interface EvolveInput {
  skill: Skill
  dataset: Dataset
  llm: LLMClient
  scorer: Scorer
  config: EvolveConfig
}

/**
 * The GEPA-style search: evaluate a baseline, then for each generation mutate
 * the current frontier, gate the variants against hard constraints, evaluate the
 * survivors, and recompute the Pareto frontier. Returns the best candidate found.
 */
export async function evolveSkill(input: EvolveInput): Promise<RunResult> {
  const { skill, dataset, llm, scorer, config } = input
  const passThreshold = config.passThreshold
  const elitism = config.elitism ?? 2

  const baselineCandidate: Candidate = { id: "baseline", generation: 0, skill }
  const baselineEval = await evaluateCandidate("baseline", skill, dataset, scorer, { passThreshold })

  // The running set of evaluated, gate-passing candidates (baseline always in).
  const evaluatedById = new Map<string, EvaluatedCandidate>()
  evaluatedById.set("baseline", {
    candidate: baselineCandidate,
    evaluation: baselineEval,
    gate: { passed: true, checks: [] },
  })

  const generations: GenerationRecord[] = []

  for (let gen = 1; gen <= config.generations; gen++) {
    const parents = currentFrontier(evaluatedById).slice(0, elitism)
    const proposed: EvaluatedCandidate[] = []

    for (let pIdx = 0; pIdx < parents.length; pIdx++) {
      const parent = evaluatedById.get(parents[pIdx])!.candidate
      const variants = await proposeVariants(parent, dataset, llm, {
        count: config.population,
        generation: gen,
        temperature: config.temperature,
        // Parent index keeps ids unique within a generation (avoids collisions
        // when two frontier parents would otherwise share a short id).
        idFor: (g, i) => `g${g}-p${pIdx}-v${i}`,
      })
      for (const variant of variants) {
        const gate = runGates(skill, variant.skill, {
          maxBytes: config.maxBytes,
          requiredHeadings: config.requiredHeadings,
        })
        if (!gate.passed) {
          proposed.push({ candidate: variant, gate, evaluation: emptyEval(variant.id) })
          continue
        }
        const evaluation = await evaluateCandidate(variant.id, variant.skill, dataset, scorer, { passThreshold })
        const ec: EvaluatedCandidate = { candidate: variant, evaluation, gate }
        proposed.push(ec)
        evaluatedById.set(variant.id, ec)
      }
    }

    const frontierIds = currentFrontier(evaluatedById)
    const best = selectBest(frontierIds.map((id) => pointFromEval(evaluatedById.get(id)!.evaluation)))
    const record: GenerationRecord = {
      generation: gen,
      evaluated: proposed,
      frontier: frontierIds,
      best: best?.id ?? "baseline",
    }
    generations.push(record)
    config.onGeneration?.(record)
  }

  const bestPoint = selectBest([...evaluatedById.values()].map((e) => pointFromEval(e.evaluation)))!
  const best = evaluatedById.get(bestPoint.id)!
  const improvedFromBaseline =
    best.candidate.id !== "baseline" &&
    best.evaluation.objectives.score > baselineEval.objectives.score &&
    best.evaluation.objectives.passRate >= baselineEval.objectives.passRate

  return { skillName: skill.name, baseline: baselineEval, generations, best, improvedFromBaseline }
}

function currentFrontier(evaluated: Map<string, EvaluatedCandidate>): string[] {
  const points: ParetoPoint[] = [...evaluated.values()].map((e) => pointFromEval(e.evaluation))
  return paretoFront(points)
    .sort((a, b) => b.score - a.score || a.sizeBytes - b.sizeBytes)
    .map((p) => p.id)
}

function emptyEval(id: string) {
  return { candidateId: id, objectives: { score: 0, passRate: 0, sizeBytes: 0 }, cases: [] }
}
