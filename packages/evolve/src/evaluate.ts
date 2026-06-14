import type { CaseScore, Dataset, EvalCase, EvalResult, Objectives, Skill } from "./types.ts"
import type { LLMClient } from "./llm.ts"
import { skillBytes } from "./skill.ts"

/** Scores how well a skill body equips the agent for a single case (0..1). */
export type Scorer = (skill: Skill, evalCase: EvalCase) => Promise<CaseScore> | CaseScore

export const DEFAULT_PASS_THRESHOLD = 0.5

/**
 * Deterministic, offline scorer. It approximates skill quality by checking that
 * the body covers the guidance a case expects and avoids the patterns it forbids.
 * This needs no model and makes the loop fully testable; swap in `llmJudgeScorer`
 * when real model access is available for higher-fidelity scoring.
 */
export function keywordScorer(): Scorer {
  return (skill, evalCase) => {
    const haystack = skill.body.toLowerCase()
    const expect = evalCase.expectKeywords ?? []
    const forbid = evalCase.forbidKeywords ?? []

    let covered = 0
    for (const kw of expect) if (haystack.includes(kw.toLowerCase())) covered++
    const coverage = expect.length === 0 ? 1 : covered / expect.length

    const violations = forbid.filter((kw) => haystack.includes(kw.toLowerCase())).length
    const penalty = forbid.length === 0 ? 0 : violations / forbid.length

    const score = clamp01(coverage - penalty)
    return {
      caseId: evalCase.id,
      score,
      detail: `coverage ${covered}/${expect.length}` + (violations ? `, ${violations} forbidden` : ""),
    }
  }
}

/**
 * LLM-judge scorer: asks the model to rate, 0..100, how well the skill would help
 * an agent handle the case. Used when credentials are available.
 */
export function llmJudgeScorer(llm: LLMClient): Scorer {
  return async (skill, evalCase) => {
    const reply = await llm.complete({
      system: "You are a strict grader. Respond with only an integer 0-100.",
      prompt: [
        "Skill body:",
        "```markdown",
        skill.body.trim(),
        "```",
        "",
        `Task: ${evalCase.prompt}`,
        evalCase.reference ? `Reference answer: ${evalCase.reference}` : "",
        "",
        "How well would this skill help an agent complete the task? Reply with only an integer 0-100.",
      ].join("\n"),
      maxTokens: 8,
      temperature: 0,
    })
    const n = Number((reply.match(/-?\d+/)?.[0] ?? "0"))
    return { caseId: evalCase.id, score: clamp01(n / 100), detail: `judge ${n}` }
  }
}

export interface EvaluateOptions {
  passThreshold?: number
}

/** Run a scorer across every case and aggregate into the search objectives. */
export async function evaluateCandidate(
  candidateId: string,
  skill: Skill,
  dataset: Dataset,
  scorer: Scorer,
  opts: EvaluateOptions = {},
): Promise<EvalResult> {
  const passThreshold = opts.passThreshold ?? DEFAULT_PASS_THRESHOLD
  const cases: CaseScore[] = []
  for (const evalCase of dataset.cases) {
    cases.push(await scorer(skill, evalCase))
  }
  const objectives = aggregate(cases, skillBytes(skill), passThreshold)
  return { candidateId, objectives, cases }
}

export function aggregate(cases: CaseScore[], sizeBytes: number, passThreshold: number): Objectives {
  if (cases.length === 0) return { score: 0, passRate: 0, sizeBytes }
  const score = cases.reduce((a, c) => a + c.score, 0) / cases.length
  const passRate = cases.filter((c) => c.score >= passThreshold).length / cases.length
  return { score, passRate, sizeBytes }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}
