import { describe, expect, test } from "bun:test"
import { canFinalize, missingFields, nextQuestionCount } from "../../src/session/plan-guard"

describe("session.plan-guard", () => {
  test("returns missing fields for incomplete plan markdown", () => {
    const markdown = ["# Plan", "", "## Steps", "1. Do work"].join("\n")
    const missing = missingFields(markdown)
    expect(missing).toContain("constraints")
    expect(missing).toContain("acceptance_criteria")
  })

  test("requires confirmed understanding before finalize", () => {
    const markdown = [
      "# Plan",
      "",
      "## Scope",
      "- API only",
      "",
      "## Constraints",
      "- No breaking changes",
      "",
      "## Steps",
      "1. Add route",
      "",
      "## Acceptance",
      "- tests pass",
    ].join("\n")
    const guard = canFinalize(markdown)
    expect(guard.confirmed).toBe(false)
    expect(guard.ok).toBe(false)
  })

  test("passes finalize when required sections and confirmation exist", () => {
    const markdown = [
      "# Plan",
      "",
      "## Scope",
      "- API only",
      "",
      "## Constraints",
      "- No breaking changes",
      "",
      "## Steps",
      "1. Add route",
      "",
      "## Acceptance",
      "- tests pass",
      "",
      "## Confirmed Understanding",
      "- User approved",
    ].join("\n")
    const guard = canFinalize(markdown)
    expect(guard.missing).toHaveLength(0)
    expect(guard.confirmed).toBe(true)
    expect(guard.ok).toBe(true)
  })

  test("adapts question count based on missing fields", () => {
    expect(nextQuestionCount({ missing: 4, hasPlan: true })).toBe(3)
    expect(nextQuestionCount({ missing: 2, hasPlan: true })).toBe(2)
    expect(nextQuestionCount({ missing: 1, hasPlan: true })).toBe(1)
    expect(nextQuestionCount({ missing: 0, hasPlan: false })).toBe(2)
  })
})
