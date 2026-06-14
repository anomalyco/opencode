import { describe, expect, test } from "bun:test"
import { headings, parseSkill, serializeSkill, skillBytes, withBody } from "../src/skill.ts"

const SAMPLE = `---
name: demo
description: a demo skill
---

# Title

Body text.

## Section
More.
`

describe("skill", () => {
  test("parses frontmatter and body", () => {
    const s = parseSkill(SAMPLE, "/x/demo/SKILL.md")
    expect(s.name).toBe("demo")
    expect(s.frontmatter.description).toBe("a demo skill")
    expect(s.body.startsWith("# Title")).toBe(true)
  })

  test("derives name from directory when frontmatter omits it", () => {
    const s = parseSkill("# No frontmatter", "/x/my-skill/SKILL.md")
    expect(s.name).toBe("my-skill")
  })

  test("round-trips through serialize", () => {
    const s = parseSkill(SAMPLE)
    const again = parseSkill(serializeSkill(s))
    expect(again.name).toBe("demo")
    expect(again.body.trim()).toBe(s.body.trim())
  })

  test("extracts headings", () => {
    const s = parseSkill(SAMPLE)
    expect(headings(s)).toEqual(["Title", "Section"])
  })

  test("withBody replaces body and changes byte size", () => {
    const s = parseSkill(SAMPLE)
    const bigger = withBody(s, s.body + "\n\nextra content here")
    expect(skillBytes(bigger)).toBeGreaterThan(skillBytes(s))
    expect(bigger.name).toBe(s.name)
  })
})
