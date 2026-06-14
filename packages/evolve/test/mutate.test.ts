import { describe, expect, test } from "bun:test"
import { buildReflectionPrompt, parseVariantReply, proposeVariants } from "../src/mutate.ts"
import { normalizeDataset } from "../src/dataset.ts"
import { MockLLMClient } from "../src/llm.ts"
import { offlineResponder } from "../src/offline.ts"
import { parseSkill } from "../src/skill.ts"
import type { Candidate } from "../src/types.ts"

const skill = parseSkill(`---
name: git-commit
---
# Git commit

Use an imperative subject.
`)

const dataset = normalizeDataset({
  cases: [
    { id: "atomic", prompt: "keep commits atomic", expectKeywords: ["atomic"] },
    { id: "secrets", prompt: "no secrets", expectKeywords: ["secret"] },
  ],
  traces: [
    { caseId: "atomic", success: false, output: "", failureReason: "no atomic guidance" },
    { caseId: "secrets", success: false, output: "", failureReason: "no secrets guidance" },
  ],
})

describe("mutate", () => {
  test("reflection prompt includes failure reasons", () => {
    const req = buildReflectionPrompt(skill, dataset)
    expect(req.prompt).toContain("no atomic guidance")
    expect(req.prompt).toContain("no secrets guidance")
  })

  test("parseVariantReply extracts skill tag and rationale", () => {
    const r = parseVariantReply("RATIONALE: add atomic\n<skill>\n# new body\n</skill>")
    expect(r.body).toBe("# new body")
    expect(r.rationale).toBe("add atomic")
  })

  test("parseVariantReply falls back to fenced block", () => {
    const r = parseVariantReply("```markdown\n# fenced body\n```")
    expect(r.body).toBe("# fenced body")
  })

  test("proposeVariants returns distinct, non-empty variants", async () => {
    const parent: Candidate = { id: "baseline", generation: 0, skill }
    const llm = new MockLLMClient(offlineResponder(dataset))
    const variants = await proposeVariants(parent, dataset, llm, { count: 2, generation: 1 })
    expect(variants.length).toBeGreaterThan(0)
    for (const v of variants) {
      expect(v.skill.body.trim().length).toBeGreaterThan(0)
      expect(v.skill.body).not.toBe(skill.body)
      expect(v.parentId).toBe("baseline")
    }
  })
})
