import { test, expect } from "bun:test"
import { Permission } from "../../src/permission"

const rule = (permission: string, pattern: string, action: "allow" | "deny" | "ask") => ({
  permission,
  pattern,
  action,
})

// Patterns produced by tools are worktree-relative (or de-rooted when the
// worktree is "/"). evaluateCandidates adds an absolutized candidate so
// absolute-path rules from config can match, while relative-semantic rules
// (e.g. "*") are only evaluated against the original pattern.

test("absolute rule matches worktree-relative pattern (fixed pain point)", () => {
  const ruleset = [rule("edit", "*", "ask"), rule("edit", "/czk/**", "allow")]
  const rules = Permission.evaluateCandidates("edit", "facts/me.md", "/czk/mem", ruleset)
  expect(rules.some((r) => r.action === "allow")).toBe(true)
})

test("relative-semantic rule does not match the absolutized candidate", () => {
  // "*": "allow" must not leak to paths outside the worktree
  const ruleset = [rule("edit", "*", "allow"), rule("edit", "../**", "ask")]
  const rules = Permission.evaluateCandidates("edit", "../../etc/x", "/home/u/proj", ruleset)
  const absolutized = rules[1]
  // The absolutized candidate only sees absolute (leading "/") rules, so it misses.
  expect(absolutized.action).toBe("ask")
  // No candidate yields allow/deny -> the ask flow falls through to "ask".
  expect(rules.every((r) => r.action === "ask")).toBe(true)
})

test("de-rooted pattern (worktree is /) resolves against absolute rules", () => {
  const ruleset = [rule("edit", "*", "ask"), rule("edit", "/czk/**", "allow")]
  const rules = Permission.evaluateCandidates("edit", "czk/x", "/", ruleset)
  expect(rules.some((r) => r.action === "allow")).toBe(true)
})

test("de-rooted pattern outside allowed prefixes still asks", () => {
  const ruleset = [rule("edit", "*", "ask"), rule("edit", "/czk/**", "allow")]
  const rules = Permission.evaluateCandidates("edit", "home/u/x", "/", ruleset)
  expect(rules.every((r) => r.action === "ask")).toBe(true)
})

test("absolute deny takes precedence over relative allow", () => {
  const ruleset = [rule("edit", "/czk/mem/secrets/**", "deny"), rule("edit", "*", "allow")]
  const rules = Permission.evaluateCandidates("edit", "secrets/key.md", "/czk/mem", ruleset)
  expect(rules.some((r) => r.action === "deny")).toBe(true)
})

test("legacy relative-only ruleset is unaffected for unmatched patterns", () => {
  const ruleset = [rule("edit", "src/**", "allow"), rule("edit", "node_modules/**", "deny")]
  expect(Permission.evaluateCandidates("edit", "src/a.ts", "/home/u/proj", ruleset).some((r) => r.action === "allow")).toBe(true)
  expect(Permission.evaluateCandidates("edit", "node_modules/x.js", "/home/u/proj", ruleset).some((r) => r.action === "deny")).toBe(true)
  expect(Permission.evaluateCandidates("edit", "README.md", "/home/u/proj", ruleset).every((r) => r.action === "ask")).toBe(true)
})

test("already-absolute patterns are not re-candidated", () => {
  const ruleset = [rule("edit", "/tmp/**", "allow")]
  const rules = Permission.evaluateCandidates("edit", "/tmp/f.txt", "/home/u/proj", ruleset)
  expect(rules).toHaveLength(1)
  expect(rules[0].action).toBe("allow")
})
