import { describe, expect, test } from "bun:test"
import { MockLLMClient, normalizeDataset, offlineResponder, parseSkill } from "@opencode-ai/evolve"
import { createOntology } from "../src/objects.ts"
import { obj } from "../src/ontology.ts"
import { learn } from "../src/dynamic.ts"

const skill = parseSkill(`---
name: git-commit
---
# Git commit

Use an imperative subject under 72 characters.
`)

const dataset = normalizeDataset({
  cases: [
    { id: "subject", prompt: "subject", expectKeywords: ["imperative"] },
    { id: "body", prompt: "body", expectKeywords: ["explain why"] },
    { id: "secrets", prompt: "secrets", expectKeywords: ["secret", "credential"] },
  ],
  traces: [
    { caseId: "body", success: false, output: "", failureReason: "no body guidance: explain why" },
    { caseId: "secrets", success: false, output: "", failureReason: "no secret/credential guidance" },
    { caseId: "subject", success: true, output: "" },
  ],
})

describe("dynamic layer", () => {
  test("updates ontology passRate and stages a governed write-back branch", async () => {
    const ontology = createOntology()
    ontology.upsert(obj("Skill", "skill_target", { name: "git-commit", path: "/x/SKILL.md", passRate: 0 }))
    const llm = new MockLLMClient(offlineResponder(dataset))

    const result = await learn(ontology, [{ skillId: "skill_target", skill, dataset }], {
      llm,
      generations: 4,
      population: 2,
    })

    // Ontology now reflects measured effectiveness.
    const update = result.updates.find((u) => u.id === "skill_target")
    expect(update).toBeDefined()
    expect(Number(ontology.property("skill_target", "passRate"))).toBeGreaterThan(0.34)

    // A governed update-skill branch is staged for review.
    expect(result.branches.length).toBe(1)
    const branch = result.branches[0]
    expect(branch.permission).toBe("aip.skill.update")
    expect(branch.change.kind).toBe("update-skill")
    expect(branch.change.skillPath).toBe("/x/SKILL.md")
    expect(branch.change.summary).toMatch(/pass .* →/)
  })

  test("no improvement => no branch", async () => {
    const clean = normalizeDataset({
      cases: [{ id: "subject", prompt: "subject", expectKeywords: ["imperative"] }],
      traces: [{ caseId: "subject", success: true, output: "" }],
    })
    const ontology = createOntology()
    ontology.upsert(obj("Skill", "skill_target", { name: "git-commit", path: "", passRate: 0 }))
    const llm = new MockLLMClient(offlineResponder(clean))
    const result = await learn(ontology, [{ skillId: "skill_target", skill, dataset: clean }], { llm })
    expect(result.branches.length).toBe(0)
  })
})
