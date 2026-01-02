import { describe, test, expect } from "bun:test"
import type { Agent } from "../src/agent/agent"
import { filterSubagents } from "../src/tool/task"
import { PermissionNext } from "../src/permission/next"

describe("filterSubagents - permission.task filtering", () => {
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): PermissionNext.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  const mockAgents = [
    { name: "general", mode: "subagent", permission: [], options: {} },
    { name: "code-reviewer", mode: "subagent", permission: [], options: {} },
    { name: "orchestrator-fast", mode: "subagent", permission: [], options: {} },
    { name: "orchestrator-slow", mode: "subagent", permission: [], options: {} },
  ] as Agent.Info[]

  test("returns all agents when permissions config is empty", () => {
    const result = filterSubagents(mockAgents, [])
    expect(result).toHaveLength(4)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("excludes agents with explicit deny", () => {
    const ruleset = createRuleset({ "code-reviewer": "deny" })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "orchestrator-fast", "orchestrator-slow"])
  })

  test("includes agents with explicit allow", () => {
    const ruleset = createRuleset({
      "code-reviewer": "allow",
      general: "deny",
    })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("includes agents with ask permission (user approval is runtime behavior)", () => {
    const ruleset = createRuleset({
      "code-reviewer": "ask",
      general: "deny",
    })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("includes agents with undefined permission (default allow)", () => {
    const ruleset = createRuleset({
      general: "deny",
    })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("supports wildcard patterns with deny", () => {
    const ruleset = createRuleset({ "orchestrator-*": "deny" })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer"])
  })

  test("supports wildcard patterns with allow", () => {
    const ruleset = createRuleset({
      "*": "allow",
      "orchestrator-fast": "deny",
    })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-slow"])
  })

  test("supports wildcard patterns with ask", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "ask",
    })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(4)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast", "orchestrator-slow"])
  })

  test("longer pattern takes precedence over shorter pattern", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast"])
  })

  test("edge case: all agents denied", () => {
    const ruleset = createRuleset({ "*": "deny" })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(0)
    expect(result).toEqual([])
  })

  test("edge case: mixed patterns with multiple wildcards", () => {
    const ruleset = createRuleset({
      "*": "ask",
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    const result = filterSubagents(mockAgents, ruleset)
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator-fast"])
  })

  test("hidden: true does not affect filtering (hidden only affects autocomplete)", () => {
    const agents = [
      { name: "general", mode: "subagent", hidden: true, permission: [], options: {} },
      { name: "code-reviewer", mode: "subagent", hidden: false, permission: [], options: {} },
      { name: "orchestrator", mode: "subagent", permission: [], options: {} },
    ] as Agent.Info[]

    const result = filterSubagents(agents, [])
    expect(result).toHaveLength(3)
    expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer", "orchestrator"])
  })

  test("hidden: true agents can be filtered by permission.task deny", () => {
    const agents = [
      { name: "general", mode: "subagent", hidden: true, permission: [], options: {} },
      { name: "orchestrator-coder", mode: "subagent", hidden: true, permission: [], options: {} },
    ] as Agent.Info[]

    const ruleset = createRuleset({ general: "deny" })
    const result = filterSubagents(agents, ruleset)
    expect(result).toHaveLength(1)
    expect(result.map((a) => a.name)).toEqual(["orchestrator-coder"])
  })
})

describe("PermissionNext.evaluate for permission.task", () => {
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): PermissionNext.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("returns ask when no match (default)", () => {
    expect(PermissionNext.evaluate("task", "code-reviewer", [])).toBe("ask")
  })

  test("returns deny for explicit deny", () => {
    const ruleset = createRuleset({ "code-reviewer": "deny" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset)).toBe("deny")
  })

  test("returns allow for explicit allow", () => {
    const ruleset = createRuleset({ "code-reviewer": "allow" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset)).toBe("allow")
  })

  test("returns ask for explicit ask", () => {
    const ruleset = createRuleset({ "code-reviewer": "ask" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset)).toBe("ask")
  })

  test("matches wildcard patterns with deny", () => {
    const ruleset = createRuleset({ "orchestrator-*": "deny" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset)).toBe("deny")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset)).toBe("deny")
    expect(PermissionNext.evaluate("task", "general", ruleset)).toBe("ask")
  })

  test("matches wildcard patterns with allow", () => {
    const ruleset = createRuleset({ "orchestrator-*": "allow" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset)).toBe("allow")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset)).toBe("allow")
  })

  test("matches wildcard patterns with ask", () => {
    const ruleset = createRuleset({ "orchestrator-*": "ask" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset)).toBe("ask")
    const globalRuleset = createRuleset({ "*": "ask" })
    expect(PermissionNext.evaluate("task", "code-reviewer", globalRuleset)).toBe("ask")
  })

  test("later rules take precedence (last match wins)", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset)).toBe("allow")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset)).toBe("deny")
  })

  test("matches global wildcard", () => {
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "allow" }))).toBe("allow")
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "deny" }))).toBe("deny")
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "ask" }))).toBe("ask")
  })
})
