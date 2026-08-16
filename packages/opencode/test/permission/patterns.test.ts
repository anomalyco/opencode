import { describe, expect, it } from "bun:test"
import { evaluate, evaluatePattern, fromConfig } from "../../src/permission/index"

describe("Permission.evaluatePattern", () => {
  it("denies an out-of-worktree file when an absolute deny rule matches its absolute form", () => {
    // write/edit/read submit files outside the worktree as `../...` patterns, so
    // the absolute form is the only thing an absolute rule can observe.
    const ruleset = fromConfig({ edit: { "*": "allow", "/home/user/.ssh/**": "deny" } })
    const rule = evaluatePattern("edit", "../.ssh/id_rsa", "/home/user/proj", ruleset)

    expect(rule.action).toBe("deny")
  })

  it("closes the gap left by the bare relative form", () => {
    const ruleset = fromConfig({ edit: { "*": "allow", "/home/user/.ssh/**": "deny" } })
    const pattern = "../.ssh/id_rsa"
    // The pre-fix evaluate() only tries the worktree-relative form, so it lets
    // the absolute deny rule slip through.
    expect(evaluate("edit", pattern, ruleset).action).toBe("allow")
    expect(evaluatePattern("edit", pattern, "/home/user/proj", ruleset).action).toBe("deny")
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

  it("keeps relative deny rules worktree-scoped", () => {
    // A relative rule must not start denying out-of-worktree files just because
    // their resolved absolute path happens to share the rule's basename prefix.
    const ruleset = fromConfig({ edit: { "*": "allow", "daily-notes/**": "deny" } })
    const rule = evaluatePattern("edit", "../daily-notes/notes.md", "/home/user/proj", ruleset)

    expect(rule.action).toBe("allow")
  })

  it("does not mangle URL patterns for non-filesystem permissions", () => {
    const ruleset = fromConfig({ webfetch: "allow" })
    const rule = evaluatePattern("webfetch", "https://opencode.ai/docs", "/home/user/proj", ruleset)

    expect(rule.action).toBe("allow")
  })
})
