import { describe, test, expect } from "bun:test"
import type { Agent } from "../src/agent/agent"
import { filterSubagents } from "../src/tool/task"
import { PermissionNext } from "../src/permission/next"
import { Config } from "../src/config/config"
import { Instance } from "../src/project/instance"
import { tmpdir } from "./fixture/fixture"

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
    expect(PermissionNext.evaluate("task", "code-reviewer", []).action).toBe("ask")
  })

  test("returns deny for explicit deny", () => {
    const ruleset = createRuleset({ "code-reviewer": "deny" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
  })

  test("returns allow for explicit allow", () => {
    const ruleset = createRuleset({ "code-reviewer": "allow" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("allow")
  })

  test("returns ask for explicit ask", () => {
    const ruleset = createRuleset({ "code-reviewer": "ask" })
    expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with deny", () => {
    const ruleset = createRuleset({ "orchestrator-*": "deny" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("deny")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
    expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with allow", () => {
    const ruleset = createRuleset({ "orchestrator-*": "allow" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset).action).toBe("allow")
  })

  test("matches wildcard patterns with ask", () => {
    const ruleset = createRuleset({ "orchestrator-*": "ask" })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("ask")
    const globalRuleset = createRuleset({ "*": "ask" })
    expect(PermissionNext.evaluate("task", "code-reviewer", globalRuleset).action).toBe("ask")
  })

  test("later rules take precedence (last match wins)", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    expect(PermissionNext.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(PermissionNext.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
  })

  test("matches global wildcard", () => {
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "allow" })).action).toBe("allow")
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "deny" })).action).toBe("deny")
    expect(PermissionNext.evaluate("task", "any-agent", createRuleset({ "*": "ask" })).action).toBe("ask")
  })
})

describe("PermissionNext.disabled for task tool", () => {
  // Note: The `disabled` function checks if a TOOL should be completely removed from the tool list.
  // It only disables a tool when there's a rule with `pattern: "*"` and `action: "deny"`.
  // It does NOT evaluate complex subagent patterns - those are handled at runtime by `evaluate`.
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): PermissionNext.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("task tool is disabled when global deny pattern exists (even with specific allows)", () => {
    // When "*": "deny" exists, the task tool is disabled because the disabled() function
    // only checks for wildcard deny patterns - it doesn't consider that specific subagents might be allowed
    const ruleset = createRuleset({
      "orchestrator-*": "allow",
      "*": "deny",
    })
    const disabled = PermissionNext.disabled(["task", "bash", "read"], ruleset)
    // The task tool IS disabled because there's a pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(true)
  })

  test("task tool is disabled when global deny pattern exists (even with ask overrides)", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "ask",
      "*": "deny",
    })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    // The task tool IS disabled because there's a pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(true)
  })

  test("task tool is disabled when global deny pattern exists", () => {
    const ruleset = createRuleset({ "*": "deny" })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    expect(disabled.has("task")).toBe(true)
  })

  test("task tool is NOT disabled when only specific patterns are denied (no wildcard)", () => {
    // The disabled() function only disables tools when pattern: "*" && action: "deny"
    // Specific subagent denies don't disable the task tool - those are handled at runtime
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      general: "deny",
    })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    // The task tool is NOT disabled because no rule has pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is enabled when no task rules exist (default ask)", () => {
    const disabled = PermissionNext.disabled(["task"], [])
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is NOT disabled when last wildcard pattern is allow", () => {
    // Last matching rule wins - if wildcard allow comes after wildcard deny, tool is enabled
    const ruleset = createRuleset({
      "*": "deny",
      "orchestrator-coder": "allow",
    })
    const disabled = PermissionNext.disabled(["task"], ruleset)
    // The disabled() function uses findLast and checks if the last matching rule
    // has pattern: "*" and action: "deny". In this case, the last rule matching
    // "task" permission has pattern "orchestrator-coder", not "*", so not disabled
    expect(disabled.has("task")).toBe(false)
  })
})

// Integration tests that load permissions from real config files
describe("permission.task with real config files", () => {
  const mockAgents = [
    { name: "general", mode: "subagent", permission: [], options: {} },
    { name: "code-reviewer", mode: "subagent", permission: [], options: {} },
    { name: "orchestrator-fast", mode: "subagent", permission: [], options: {} },
  ] as Agent.Info[]

  test("loads task permissions from opencode.json config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "allow",
            "code-reviewer": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})
        const result = filterSubagents(mockAgents, ruleset)
        expect(result.map((a) => a.name)).toEqual(["general", "orchestrator-fast"])
      },
    })
  })

  test("loads task permissions with wildcard patterns from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "ask",
            "orchestrator-*": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})
        const result = filterSubagents(mockAgents, ruleset)
        expect(result.map((a) => a.name)).toEqual(["general", "code-reviewer"])
      },
    })
  })

  test("evaluate respects task permission from config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            general: "allow",
            "code-reviewer": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
        // Unspecified agents default to "ask"
        expect(PermissionNext.evaluate("task", "unknown-agent", ruleset).action).toBe("ask")
      },
    })
  })

  test("mixed permission config with task and other tools", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          bash: "allow",
          edit: "ask",
          task: {
            "*": "deny",
            general: "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})

        // Verify task permissions
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // Verify other tool permissions
        expect(PermissionNext.evaluate("bash", "*", ruleset).action).toBe("allow")
        expect(PermissionNext.evaluate("edit", "*", ruleset).action).toBe("ask")

        // Verify disabled tools
        const disabled = PermissionNext.disabled(["bash", "edit", "task"], ruleset)
        expect(disabled.has("bash")).toBe(false)
        expect(disabled.has("edit")).toBe(false)
        // task is NOT disabled because disabled() uses findLast, and the last rule
        // matching "task" permission is {pattern: "general", action: "allow"}, not pattern: "*"
        expect(disabled.has("task")).toBe(false)
      },
    })
  })

  test("task tool disabled when global deny comes last in config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            general: "allow",
            "code-reviewer": "allow",
            "*": "deny",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})

        // Last matching rule wins - "*" deny is last, so all agents are denied
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("deny")
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
        expect(PermissionNext.evaluate("task", "unknown", ruleset).action).toBe("deny")

        // Since "*": "deny" is the last rule, disabled() finds it with findLast
        // and sees pattern: "*" with action: "deny", so task is disabled
        const disabled = PermissionNext.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(true)
      },
    })
  })

  test("task tool NOT disabled when specific allow comes last in config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        permission: {
          task: {
            "*": "deny",
            general: "allow",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        const ruleset = PermissionNext.fromConfig(config.permission ?? {})

        // Evaluate uses findLast - "general" allow comes after "*" deny
        expect(PermissionNext.evaluate("task", "general", ruleset).action).toBe("allow")
        // Other agents still denied by the earlier "*" deny
        expect(PermissionNext.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // disabled() uses findLast and checks if the last rule has pattern: "*" with action: "deny"
        // In this case, the last rule is {pattern: "general", action: "allow"}, not pattern: "*"
        // So the task tool is NOT disabled (even though most subagents are denied)
        const disabled = PermissionNext.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(false)
      },
    })
  })
})
