import { describe, expect, test } from "bun:test"
import { lineDiff, skillDiff } from "../src/deploy.ts"
import { parseSkill, withBody } from "../src/skill.ts"

describe("deploy", () => {
  test("lineDiff reports added and removed lines", () => {
    const diff = lineDiff("a\nb\nc", "a\nc\nd")
    expect(diff).toContain("- b")
    expect(diff).toContain("+ d")
    expect(diff).not.toContain("- a")
  })

  test("skillDiff shows body changes", () => {
    const original = parseSkill("---\nname: x\n---\n\n# Title\nold line\n")
    const variant = withBody(original, "# Title\nnew line\n")
    const diff = skillDiff(original, variant)
    expect(diff).toContain("- old line")
    expect(diff).toContain("+ new line")
  })
})
