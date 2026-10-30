import { describe, expect, it } from "bun:test"
import { parseCursorMdc, parseClaudeMd, parseAgentsMd, formatInstructions } from "../../src/extension/rules/adapter.js"

describe("RulesAdapter", () => {
  it("parses Cursor .mdc rule with frontmatter globs and alwaysApply", () => {
    const raw = `---
description: React components conventions
globs: src/components/**/*.tsx, src/views/**/*.tsx
alwaysApply: false
---
Use functional components and hooks only.`

    const rule = parseCursorMdc("/workspace/.cursor/rules/react.mdc", raw)
    expect(rule.originPlatform).toBe("cursor")
    expect(rule.name).toBe("React components conventions")
    expect(rule.globs).toEqual(["src/components/**/*.tsx", "src/views/**/*.tsx"])
    expect(rule.alwaysApply).toBe(false)
    expect(rule.content.trim()).toBe("Use functional components and hooks only.")
  })

  it("parses CLAUDE.md and AGENTS.md instructions", () => {
    const claudeRule = parseClaudeMd("/path/CLAUDE.md", "Run bun test before committing.")
    expect(claudeRule.originPlatform).toBe("claude")
    expect(claudeRule.alwaysApply).toBe(true)

    const agentsRule = parseAgentsMd("/path/AGENTS.md", "Keep durable events minimal.")
    expect(agentsRule.originPlatform).toBe("opencode")
    expect(agentsRule.alwaysApply).toBe(true)
  })

  it("formats instructions respecting globs and precedence", () => {
    const r1 = parseCursorMdc("/fake/react.mdc", "---\ndescription: React\nglobs: src/components/**/*.tsx\n---\nReact rule")
    const r2 = parseAgentsMd("/fake/AGENTS.md", "Global agent rule")

    const matching = formatInstructions([r1, r2], "src/components/Button.tsx")
    expect(matching).toContain("React rule")
    expect(matching).toContain("Global agent rule")

    const nonMatching = formatInstructions([r1, r2], "packages/core/index.ts")
    expect(nonMatching).not.toContain("React rule")
    expect(nonMatching).toContain("Global agent rule")
  })
})
