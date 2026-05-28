import { describe, test, expect } from "bun:test"
import path from "path"
import { Permission } from "../../src/permission"

const makeRuleset = (rules: Record<string, "allow" | "deny" | "ask">): Permission.Rule[] =>
  Object.entries(rules).map(([pattern, action]) => ({
    permission: "read",
    pattern,
    action,
  })) as Permission.Rule[]

describe("file permission deny filtering (issue #29674)", () => {
  test("**/.env* rule denies .env at root (wildcard fix)", () => {
    const ruleset = makeRuleset({ "**/.env*": "deny" })
    expect(Permission.evaluate("read", ".env", ruleset).action).toBe("deny")
    expect(Permission.evaluate("read", ".env.local", ruleset).action).toBe("deny")
  })

  test("**/.env* rule still denies .env in subdirs", () => {
    const ruleset = makeRuleset({ "**/.env*": "deny" })
    expect(Permission.evaluate("read", "subdir/.env", ruleset).action).toBe("deny")
    expect(Permission.evaluate("read", "a/b/.env.production", ruleset).action).toBe("deny")
  })

  test("**/.env* rule does not deny unrelated files", () => {
    const ruleset = makeRuleset({ "**/.env*": "deny" })
    expect(Permission.evaluate("read", "main.ts", ruleset).action).toBe("ask")
    expect(Permission.evaluate("read", "README.md", ruleset).action).toBe("ask")
  })

  test("glob result filtering removes denied files", () => {
    const ruleset = makeRuleset({ "**/.env*": "deny" })
    const resultPaths = [".env", "src/index.ts", ".env.local", "README.md"]
    const filtered = resultPaths.filter(
      (p) => Permission.evaluate("read", p, ruleset).action !== "deny",
    )
    expect(filtered).toEqual(["src/index.ts", "README.md"])
  })
})

describe("grep result filtering", () => {
  test("grep result filtering removes denied file matches", () => {
    const ruleset = makeRuleset({ "**/.env*": "deny" })
    const matchRows = [
      { path: "/project/.env", line: 1, text: "SECRET=abc" },
      { path: "/project/src/app.ts", line: 10, text: "const x = 1" },
      { path: "/project/.env.local", line: 2, text: "DB_URL=postgres" },
    ]
    const worktree = "/project"
    const filtered = matchRows.filter((row) => {
      const relPath = path.relative(worktree, row.path)
      return Permission.evaluate("read", relPath, ruleset).action !== "deny"
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].path).toBe("/project/src/app.ts")
  })
})

describe("issue #29674 full scenario", () => {
  test("user config deny rule blocks .env at root for read", () => {
    // Simulates: user writes { "read": { "**/.env*": "deny" } } in opencode.jsonc
    const ruleset = Permission.fromConfig({ read: { "**/.env*": "deny" } })
    expect(Permission.evaluate("read", ".env", ruleset).action).toBe("deny")
    expect(Permission.evaluate("read", ".env.local", ruleset).action).toBe("deny")
    expect(Permission.evaluate("read", "src/main.ts", ruleset).action).toBe("ask")
  })

  test("user config deny rule blocks .env in subfolder for read", () => {
    const ruleset = Permission.fromConfig({ read: { "**/.env*": "deny" } })
    expect(Permission.evaluate("read", "config/.env", ruleset).action).toBe("deny")
  })

  test("default agent rules deny .env via *.env pattern", () => {
    // Simulates agent.ts defaults: "*.env": "ask", "*.env.*": "ask"
    const ruleset = Permission.fromConfig({ read: { "*.env": "ask", "*.env.*": "ask" } })
    expect(Permission.evaluate("read", ".env", ruleset).action).toBe("ask")
    expect(Permission.evaluate("read", ".env.local", ruleset).action).toBe("ask")
  })
})
