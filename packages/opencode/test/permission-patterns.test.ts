import { describe, expect, it } from "bun:test"
import { evaluatePattern, fromConfig } from "../src/permission/index"

describe("Permission.evaluatePattern", () => {
  it("denies an out-of-worktree file when an absolute deny rule matches its absolute form (fail-closed)", () => {
    const ruleset = fromConfig({ edit: { "*": "allow", "/home/user/.ssh/**": "deny" } })
    const rule = evaluatePattern("edit", "../.ssh/id_rsa", "/home/user/proj", ruleset)

    expect(rule.action).toBe("deny")
  })

  it("allows an out-of-worktree file when an absolute allow rule overrides a deny-all", () => {
    const ruleset = fromConfig({ edit: { "*": "deny", "/home/user/daily-notes/**": "allow" } })
    const rule = evaluatePattern("edit", "../daily-notes/2026-08.md", "/home/user/proj", ruleset)

    expect(rule.action).toBe("allow")
  })

  it("keeps matching worktree-relative rules against relative patterns", () => {
    const ruleset = fromConfig({ edit: { "*": "deny", "daily-notes/**": "allow" } })
    const rule = evaluatePattern("edit", "daily-notes/a.md", "/home/user/proj", ruleset)

    expect(rule.action).toBe("allow")
  })

  it("does not mangle URL patterns for non-filesystem permissions", () => {
    const ruleset = fromConfig({ webfetch: "allow" })
    const rule = evaluatePattern("webfetch", "https://opencode.ai/docs", "/home/user/proj", ruleset)

    expect(rule.action).toBe("allow")
  })

  it("denies an in-worktree file via its absolute form when a relative deny rule matches", () => {
    const ruleset = fromConfig({ edit: { "*": "allow", "daily-notes/secret/**": "deny" } })
    const rule = evaluatePattern("edit", "daily-notes/secret/a.md", "/home/user/proj", ruleset)

    expect(rule.action).toBe("deny")
  })
})
