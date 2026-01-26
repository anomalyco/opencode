import { test, expect, describe, beforeEach } from "bun:test"
import { SmartRule } from "../../src/smart-rule"
import { Instance } from "../../src/project/instance"
import { Flag } from "../../src/flag/flag"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("SmartRule.Frontmatter", () => {
  test("should parse valid frontmatter with paths", () => {
    const result = SmartRule.Frontmatter.safeParse({
      description: "Test rule",
      paths: ["**/*.ts"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBe("Test rule")
      expect(result.data.paths).toEqual(["**/*.ts"])
    }
  })

  test("should parse valid frontmatter with globs alias", () => {
    const result = SmartRule.Frontmatter.safeParse({
      globs: ["**/*.css"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.globs).toEqual(["**/*.css"])
    }
  })

  test("should parse valid frontmatter with patterns alias", () => {
    const result = SmartRule.Frontmatter.safeParse({
      patterns: ["src/**/*.tsx"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.patterns).toEqual(["src/**/*.tsx"])
    }
  })

  test("should parse alwaysApply flag", () => {
    const result = SmartRule.Frontmatter.safeParse({
      alwaysApply: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.alwaysApply).toBe(true)
    }
  })

  test("should allow empty frontmatter", () => {
    const result = SmartRule.Frontmatter.safeParse({})
    expect(result.success).toBe(true)
  })
})

describe("SmartRule.track", () => {
  test("should track files when feature is enabled", async () => {
    // Save original flag value
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Force enable the flag for this test
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-session-1"
        SmartRule.track(sessionID, path.join(tmp.path, "src/index.ts"))
        SmartRule.track(sessionID, path.join(tmp.path, "src/utils.ts"))

        const state = SmartRule.state()
        expect(state.files[sessionID]).toBeDefined()
        expect(state.files[sessionID].size).toBe(2)
        expect(state.files[sessionID].has("src/index.ts")).toBe(true)
        expect(state.files[sessionID].has("src/utils.ts")).toBe(true)

        // Clean up
        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should normalize absolute paths to relative", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-session-2"
        // Track with absolute path
        SmartRule.track(sessionID, path.join(tmp.path, "deep/nested/file.ts"))

        const state = SmartRule.state()
        // Should be stored as relative path
        expect(state.files[sessionID].has("deep/nested/file.ts")).toBe(true)

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should ignore paths outside project", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-session-3"
        // Track a path outside the project
        SmartRule.track(sessionID, "/some/external/path.ts")

        const state = SmartRule.state()
        // Should not be tracked (starts with ..)
        expect(state.files[sessionID]?.size ?? 0).toBe(0)

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })
})

describe("SmartRule.clearSession", () => {
  test("should remove session tracking data", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-session-clear"
        SmartRule.track(sessionID, path.join(tmp.path, "file.ts"))

        let state = SmartRule.state()
        expect(state.files[sessionID]).toBeDefined()

        SmartRule.clearSession(sessionID)

        state = SmartRule.state()
        expect(state.files[sessionID]).toBeUndefined()

        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })
})

describe("SmartRule.inject", () => {
  test("should return empty when feature is disabled", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = false

        const result = await SmartRule.inject("any-session")
        expect(result).toEqual([])

        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should return empty when no files tracked", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const result = await SmartRule.inject("empty-session")
        expect(result).toEqual([])

        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should match rules by glob pattern", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create a rule file
        const rulesDir = path.join(dir, ".opencode", "rules")
        await Bun.write(
          path.join(rulesDir, "typescript.md"),
          `---
description: "TypeScript rules"
paths:
  - "**/*.ts"
---

# TypeScript

Use strict mode.
`
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-inject-match"
        // Track a .ts file
        SmartRule.track(sessionID, path.join(tmp.path, "src/index.ts"))

        // Reset rules cache to force rediscovery
        SmartRule.state().rules = null

        const result = await SmartRule.inject(sessionID)
        expect(result.length).toBe(1)
        expect(result[0]).toContain("TypeScript")
        expect(result[0]).toContain("Use strict mode.")
        expect(result[0]).toContain("<context-rules>")

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should include alwaysApply rules regardless of files", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const rulesDir = path.join(dir, ".opencode", "rules")
        await Bun.write(
          path.join(rulesDir, "always.md"),
          `---
description: "Always applied"
alwaysApply: true
---

# Always Rule

This is always included.
`
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-always-apply"
        // Track a random file that won't match any pattern
        SmartRule.track(sessionID, path.join(tmp.path, "random.xyz"))

        SmartRule.state().rules = null

        const result = await SmartRule.inject(sessionID)
        expect(result.length).toBe(1)
        expect(result[0]).toContain("Always Rule")
        expect(result[0]).toContain("This is always included.")

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should not match rules without patterns", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const rulesDir = path.join(dir, ".opencode", "rules")
        await Bun.write(
          path.join(rulesDir, "no-patterns.md"),
          `---
description: "No patterns rule"
---

# No Patterns

Should never match.
`
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-no-patterns"
        SmartRule.track(sessionID, path.join(tmp.path, "any-file.ts"))

        SmartRule.state().rules = null

        const result = await SmartRule.inject(sessionID)
        expect(result).toEqual([])

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should support globs alias for patterns", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const rulesDir = path.join(dir, ".opencode", "rules")
        await Bun.write(
          path.join(rulesDir, "css.md"),
          `---
description: "CSS rules"
globs:
  - "**/*.css"
---

# CSS

Format properly.
`
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        const sessionID = "test-globs-alias"
        SmartRule.track(sessionID, path.join(tmp.path, "styles/main.css"))

        SmartRule.state().rules = null

        const result = await SmartRule.inject(sessionID)
        expect(result.length).toBe(1)
        expect(result[0]).toContain("CSS")

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })
})

describe("SmartRule discovery", () => {
  test("should discover rules from .opencode/rules/", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const rulesDir = path.join(dir, ".opencode", "rules")
        await Bun.write(
          path.join(rulesDir, "test-rule.md"),
          `---
description: "Test rule"
paths: ["**/*.ts"]
---

Content.
`
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true

        SmartRule.state().rules = null

        const sessionID = "test-discovery"
        SmartRule.track(sessionID, path.join(tmp.path, "file.ts"))

        const result = await SmartRule.inject(sessionID)
        expect(result.length).toBe(1)

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
      },
    })
  })

  test("should discover rules from .claude/rules/ for compatibility", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES
    const originalClaudeFlag = Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const rulesDir = path.join(dir, ".claude", "rules")
        await Bun.write(
          path.join(rulesDir, "claude-rule.md"),
          `---
description: "Claude rule"
paths: ["**/*.js"]
---

Claude content.
`
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true
        ;(Flag as any).OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = false

        SmartRule.state().rules = null

        const sessionID = "test-claude-compat"
        SmartRule.track(sessionID, path.join(tmp.path, "app.js"))

        const result = await SmartRule.inject(sessionID)
        expect(result.length).toBe(1)
        expect(result[0]).toContain("Claude content")

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
        ;(Flag as any).OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = originalClaudeFlag
      },
    })
  })

  test("opencode rules should take precedence over claude rules", async () => {
    const originalFlag = Flag.OPENCODE_EXPERIMENTAL_SMART_RULES
    const originalClaudeFlag = Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT

    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create same-named rule in both directories
        const opencodeRulesDir = path.join(dir, ".opencode", "rules")
        const claudeRulesDir = path.join(dir, ".claude", "rules")

        await Bun.write(
          path.join(claudeRulesDir, "shared.md"),
          `---
description: "Claude version"
paths: ["**/*.ts"]
---

Claude content - should NOT appear.
`
        )

        await Bun.write(
          path.join(opencodeRulesDir, "shared.md"),
          `---
description: "OpenCode version"
paths: ["**/*.ts"]
---

OpenCode content - should appear.
`
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = true
        ;(Flag as any).OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = false

        SmartRule.state().rules = null

        const sessionID = "test-precedence"
        SmartRule.track(sessionID, path.join(tmp.path, "index.ts"))

        const result = await SmartRule.inject(sessionID)
        expect(result.length).toBe(1)
        expect(result[0]).toContain("OpenCode content - should appear.")
        expect(result[0]).not.toContain("Claude content - should NOT appear.")

        SmartRule.clearSession(sessionID)
        ;(Flag as any).OPENCODE_EXPERIMENTAL_SMART_RULES = originalFlag
        ;(Flag as any).OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = originalClaudeFlag
      },
    })
  })
})
