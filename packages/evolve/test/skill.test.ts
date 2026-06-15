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

  test("preserves rich (list/multi-line) frontmatter verbatim on write-back", () => {
    const rich = `---
name: deploy
allowed-tools: [bash, edit]
tags:
  - ops
  - ci
description: "Deploy: do it well"
---

# Deploy
old body
`
    const s = parseSkill(rich, "/x/deploy/SKILL.md")
    expect(s.name).toBe("deploy")
    // Editing the body must not mangle the YAML list/map frontmatter.
    const edited = withBody(s, "# Deploy\nnew body")
    const out = serializeSkill(edited)
    expect(out).toContain("allowed-tools: [bash, edit]")
    expect(out).toContain("  - ops")
    expect(out).toContain("  - ci")
    expect(out).toContain("new body")
    expect(out).not.toContain("old body")
  })

  test("withBody replaces body and changes byte size", () => {
    const s = parseSkill(SAMPLE)
    const bigger = withBody(s, s.body + "\n\nextra content here")
    expect(skillBytes(bigger)).toBeGreaterThan(skillBytes(s))
    expect(bigger.name).toBe(s.name)
  })
})
