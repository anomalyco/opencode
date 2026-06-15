import { evolveSkill, keywordScorer, serializeSkill, type Dataset, type LLMClient, type Skill } from "@opencode-ai/evolve"
import type { Ontology } from "./ontology.ts"
import type { ActionBranch } from "./types.ts"
import { openBranch } from "./governance.ts"
import { updateSkillAction } from "./actions.ts"

/** An outcome bundle for one skill: its current artifact + recorded traces. */
export interface SkillOutcome {
  /** Ontology object id for the Skill. */
  skillId: string
  skill: Skill
  dataset: Dataset
}

export interface LearnOptions {
  llm: LLMClient
  generations?: number
  population?: number
}

export interface PropertyUpdate {
  id: string
  property: string
  before: unknown
  after: unknown
}

export interface LearnResult {
  updates: PropertyUpdate[]
  branches: ActionBranch[]
}

/**
 * The dynamic layer: for each skill outcome, measure current effectiveness,
 * write it back onto the ontology object (so the graph reflects reality), and —
 * when evolution finds a better variant — emit a governed `update-skill` branch
 * for review. This closes the loop: outcome → learn → update ontology → propose.
 */
export async function learn(
  ontology: Ontology,
  outcomes: SkillOutcome[],
  opts: LearnOptions,
): Promise<LearnResult> {
  const updates: PropertyUpdate[] = []
  const branches: ActionBranch[] = []

  for (const outcome of outcomes) {
    const run = await evolveSkill({
      skill: outcome.skill,
      dataset: outcome.dataset,
      llm: opts.llm,
      scorer: keywordScorer(),
      config: { generations: opts.generations ?? 3, population: opts.population ?? 2 },
    })

    // Reflect measured effectiveness back onto the ontology object.
    const obj = ontology.get(outcome.skillId)
    if (obj && obj.type === "Skill") {
      const before = obj.properties.passRate
      const after = run.best.evaluation.objectives.passRate
      ontology.setProperty(outcome.skillId, "passRate", after)
      ontology.setProperty(outcome.skillId, "sizeBytes", run.best.evaluation.objectives.sizeBytes)
      updates.push({ id: outcome.skillId, property: "passRate", before, after })
    }

    // When evolution improved the skill, stage a governed write-back branch.
    if (run.improvedFromBaseline) {
      const before = serializeSkill(outcome.skill)
      const after = serializeSkill(run.best.candidate.skill)
      branches.push(
        openBranch(
          updateSkillAction,
          {
            kind: "update-skill",
            targetId: outcome.skillId,
            skillPath: String(obj?.properties.path ?? outcome.skill.path ?? ""),
            newBody: after,
            before,
            after,
            summary: `evolve ${outcome.skill.name}: pass ${pct(run.baseline.objectives.passRate)} → ${pct(
              run.best.evaluation.objectives.passRate,
            )}`,
          },
          run.best.candidate.rationale,
        ),
      )
    }
  }

  return { updates, branches }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}
