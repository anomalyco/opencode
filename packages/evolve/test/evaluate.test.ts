import { describe, expect, test } from "bun:test"
import { aggregate, evaluateCandidate, keywordScorer } from "../src/evaluate.ts"
import { normalizeDataset } from "../src/dataset.ts"
import { parseSkill } from "../src/skill.ts"

describe("evaluate", () => {
  const scorer = keywordScorer()
  const skill = parseSkill(`---
name: t
---
Use an imperative subject under 72 characters. Keep commits atomic.
`)

  test("keyword scorer: full coverage = 1, none = 0", async () => {
    const hit = await scorer(skill, { id: "a", prompt: "", expectKeywords: ["imperative", "atomic"] })
    const miss = await scorer(skill, { id: "b", prompt: "", expectKeywords: ["rebase", "squash"] })
    expect(hit.score).toBe(1)
    expect(miss.score).toBe(0)
  })

  test("forbidden keywords penalize", async () => {
    const s = await scorer(skill, { id: "c", prompt: "", expectKeywords: ["imperative"], forbidKeywords: ["atomic"] })
    expect(s.score).toBe(0)
  })

  test("aggregate computes mean score and pass rate", () => {
    const obj = aggregate(
      [
        { caseId: "1", score: 1 },
        { caseId: "2", score: 0.4 },
        { caseId: "3", score: 0.6 },
      ],
      500,
      0.5,
    )
    expect(obj.score).toBeCloseTo(0.6667, 3)
    expect(obj.passRate).toBeCloseTo(0.6667, 3)
    expect(obj.sizeBytes).toBe(500)
  })

  test("evaluateCandidate aggregates across a dataset", async () => {
    const dataset = normalizeDataset({
      cases: [
        { id: "1", prompt: "", expectKeywords: ["imperative"] },
        { id: "2", prompt: "", expectKeywords: ["nonexistent"] },
      ],
    })
    const result = await evaluateCandidate("cand", skill, dataset, scorer)
    expect(result.candidateId).toBe("cand")
    expect(result.objectives.score).toBe(0.5)
    expect(result.objectives.passRate).toBe(0.5)
  })
})
