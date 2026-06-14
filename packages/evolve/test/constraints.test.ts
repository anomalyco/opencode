import { describe, expect, test } from "bun:test"
import { MAX_SKILL_BYTES, runGates } from "../src/constraints.ts"
import { parseSkill, withBody } from "../src/skill.ts"

const original = parseSkill(`---
name: demo
---

# Title

## Keep me

body
`)

describe("constraints", () => {
  test("passes a reasonable variant", () => {
    const variant = withBody(original, original.body + "\n\nmore guidance")
    const result = runGates(original, variant)
    expect(result.passed).toBe(true)
  })

  test("fails empty body", () => {
    const variant = withBody(original, "   ")
    const result = runGates(original, variant)
    expect(result.passed).toBe(false)
    expect(result.checks.find((c) => c.name === "non-empty")?.passed).toBe(false)
  })

  test("fails when over the size budget", () => {
    const variant = withBody(original, "x".repeat(MAX_SKILL_BYTES + 1))
    const result = runGates(original, variant)
    expect(result.checks.find((c) => c.name === "size")?.passed).toBe(false)
  })

  test("fails when frontmatter name changes", () => {
    const variant = { ...withBody(original, original.body), name: "renamed" }
    const result = runGates(original, variant)
    expect(result.checks.find((c) => c.name === "name-preserved")?.passed).toBe(false)
  })

  test("fails when a required heading is dropped", () => {
    const variant = withBody(original, "# Title\n\nbody only")
    const result = runGates(original, variant, { requiredHeadings: ["Keep me"] })
    expect(result.checks.find((c) => c.name === "required-headings")?.passed).toBe(false)
  })
})
