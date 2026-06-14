import { describe, expect, test } from "bun:test"
import { evolveSkill } from "../src/gepa.ts"
import { keywordScorer } from "../src/evaluate.ts"
import { normalizeDataset } from "../src/dataset.ts"
import { MockLLMClient } from "../src/llm.ts"
import { offlineResponder } from "../src/offline.ts"
import { renderReport } from "../src/report.ts"
import { deployBest } from "../src/deploy.ts"
import { parseSkill, skillBytes } from "../src/skill.ts"
import { MAX_SKILL_BYTES } from "../src/constraints.ts"

const skill = parseSkill(`---
name: git-commit
---
# Git commit

Use an imperative subject under 72 characters.
`)

const dataset = normalizeDataset({
  cases: [
    { id: "subject", prompt: "subject", expectKeywords: ["imperative", "72 characters"] },
    { id: "body", prompt: "body", expectKeywords: ["explain why"] },
    { id: "secrets", prompt: "secrets", expectKeywords: ["secret", "credential"] },
    { id: "atomic", prompt: "atomic", expectKeywords: ["atomic", "unrelated"] },
  ],
  traces: [
    { caseId: "body", success: false, output: "", failureReason: "no body guidance: explain why" },
    { caseId: "secrets", success: false, output: "", failureReason: "no secret/credential guidance" },
    { caseId: "atomic", success: false, output: "", failureReason: "no atomic/unrelated guidance" },
    { caseId: "subject", success: true, output: "" },
  ],
})

describe("evolveSkill (offline)", () => {
  test("improves the baseline and stays within the size gate", async () => {
    const llm = new MockLLMClient(offlineResponder(dataset))
    const run = await evolveSkill({
      skill,
      dataset,
      llm,
      scorer: keywordScorer(),
      config: { generations: 4, population: 2, requiredHeadings: ["Git commit"] },
    })

    expect(run.improvedFromBaseline).toBe(true)
    expect(run.best.evaluation.objectives.score).toBeGreaterThan(run.baseline.objectives.score)
    expect(run.best.evaluation.objectives.passRate).toBeGreaterThanOrEqual(run.baseline.objectives.passRate)
    expect(skillBytes(run.best.candidate.skill)).toBeLessThanOrEqual(MAX_SKILL_BYTES)

    // Baseline only covers the subject case (1/4 passing).
    expect(run.baseline.objectives.passRate).toBeCloseTo(0.25, 5)
  })

  test("renders a report and deploys the winner", async () => {
    const llm = new MockLLMClient(offlineResponder(dataset))
    const run = await evolveSkill({
      skill,
      dataset,
      llm,
      scorer: keywordScorer(),
      config: { generations: 3, population: 2 },
    })

    const report = renderReport(run)
    expect(report).toContain("# Evolution report: git-commit")
    expect(report).toContain("## Generations")

    const deploy = deployBest(run, skill, "") // empty path => no write, just diff
    expect(deploy.changed).toBe(true)
    expect(deploy.diff).toContain("+")
  })

  test("no failures => baseline kept, no false improvement", async () => {
    const clean = normalizeDataset({
      cases: [{ id: "subject", prompt: "subject", expectKeywords: ["imperative"] }],
      traces: [{ caseId: "subject", success: true, output: "" }],
    })
    const llm = new MockLLMClient(offlineResponder(clean))
    const run = await evolveSkill({
      skill,
      dataset: clean,
      llm,
      scorer: keywordScorer(),
      config: { generations: 2, population: 2 },
    })
    expect(run.baseline.objectives.passRate).toBe(1)
    expect(run.improvedFromBaseline).toBe(false)
  })
})
