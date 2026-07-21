import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { Permission } from "../src/permission"
import { Config } from "@/config/config"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Config.node))

const load = Config.use.get()

describe("Permission.evaluate for permission.task", () => {
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): PermissionV1.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("returns ask when no match (default)", () => {
    expect(Permission.evaluate("task", "code-reviewer", []).action).toBe("ask")
  })

  test("returns deny for explicit deny", () => {
    const ruleset = createRuleset({ "code-reviewer": "deny" })
    expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
  })

  test("returns allow for explicit allow", () => {
    const ruleset = createRuleset({ "code-reviewer": "allow" })
    expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("allow")
  })

  test("returns ask for explicit ask", () => {
    const ruleset = createRuleset({ "code-reviewer": "ask" })
    expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with deny", () => {
    const ruleset = createRuleset({ "orchestrator-*": "deny" })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("deny")
    expect(Permission.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
    expect(Permission.evaluate("task", "general", ruleset).action).toBe("ask")
  })

  test("matches wildcard patterns with allow", () => {
    const ruleset = createRuleset({ "orchestrator-*": "allow" })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(Permission.evaluate("task", "orchestrator-slow", ruleset).action).toBe("allow")
  })

  test("matches wildcard patterns with ask", () => {
    const ruleset = createRuleset({ "orchestrator-*": "ask" })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("ask")
    const globalRuleset = createRuleset({ "*": "ask" })
    expect(Permission.evaluate("task", "code-reviewer", globalRuleset).action).toBe("ask")
  })

  test("more specific pattern beats broader deny", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      "orchestrator-fast": "allow",
    })
    expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
    expect(Permission.evaluate("task", "orchestrator-slow", ruleset).action).toBe("deny")
  })

  test("matches global wildcard", () => {
    expect(Permission.evaluate("task", "any-agent", createRuleset({ "*": "allow" })).action).toBe("allow")
    expect(Permission.evaluate("task", "any-agent", createRuleset({ "*": "deny" })).action).toBe("deny")
    expect(Permission.evaluate("task", "any-agent", createRuleset({ "*": "ask" })).action).toBe("ask")
  })
})

describe("Permission.disabled for task tool", () => {
  // Note: The `disabled` function checks if a TOOL should be completely removed from the tool list.
  // It only disables a tool when there's a rule with `pattern: "*"` and `action: "deny"`.
  // It does NOT evaluate complex subagent patterns - those are handled at runtime by `evaluate`.
  const createRuleset = (rules: Record<string, "allow" | "deny" | "ask">): PermissionV1.Ruleset =>
    Object.entries(rules).map(([pattern, action]) => ({
      permission: "task",
      pattern,
      action,
    }))

  test("task tool is NOT disabled when specific allow overrides global deny", () => {
    // Even though "*": "deny" exists, the specific "orchestrator-*": "allow"
    // has higher pattern specificity, so the tool is not disabled
    const ruleset = createRuleset({
      "orchestrator-*": "allow",
      "*": "deny",
    })
    const disabled = Permission.disabled(["task", "bash", "read"], ruleset)
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is NOT disabled when specific ask overrides global deny", () => {
    const ruleset = createRuleset({
      "orchestrator-*": "ask",
      "*": "deny",
    })
    const disabled = Permission.disabled(["task"], ruleset)
    // Specific pattern "orchestrator-*" beats "*" due to pattern specificity
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is disabled when global deny pattern exists", () => {
    const ruleset = createRuleset({ "*": "deny" })
    const disabled = Permission.disabled(["task"], ruleset)
    expect(disabled.has("task")).toBe(true)
  })

  test("task tool is NOT disabled when only specific patterns are denied (no wildcard)", () => {
    // The disabled() function only disables tools when pattern: "*" && action: "deny"
    // Specific subagent denies don't disable the task tool - those are handled at runtime
    const ruleset = createRuleset({
      "orchestrator-*": "deny",
      general: "deny",
    })
    const disabled = Permission.disabled(["task"], ruleset)
    // The task tool is NOT disabled because no rule has pattern: "*" with action: "deny"
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is enabled when no task rules exist (default ask)", () => {
    const disabled = Permission.disabled(["task"], [])
    expect(disabled.has("task")).toBe(false)
  })

  test("task tool is NOT disabled when specific allow overrides wildcard deny", () => {
    const ruleset = createRuleset({
      "*": "deny",
      "orchestrator-coder": "allow",
    })
    const disabled = Permission.disabled(["task"], ruleset)
    // "orchestrator-coder" has higher pattern specificity than "*", so it wins
    expect(disabled.has("task")).toBe(false)
  })
})

// Integration tests that load permissions from real config files
describe("permission.task with real config files", () => {
  it.instance(
    "loads task permissions from opencode.json config",
    () =>
      Effect.gen(function* () {
        const config = yield* load
        const ruleset = Permission.fromConfig(config.permission ?? {})
        // general and orchestrator-fast should be allowed, code-reviewer denied
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
      }),
    {
      git: true,
      config: {
        permission: {
          task: {
            "*": "allow",
            "code-reviewer": "deny",
          },
        },
      },
    },
  )

  it.instance(
    "loads task permissions with wildcard patterns from config",
    () =>
      Effect.gen(function* () {
        const config = yield* load
        const ruleset = Permission.fromConfig(config.permission ?? {})
        // general and code-reviewer should be ask, orchestrator-* denied
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("ask")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("ask")
        expect(Permission.evaluate("task", "orchestrator-fast", ruleset).action).toBe("deny")
      }),
    {
      git: true,
      config: {
        permission: {
          task: {
            "*": "ask",
            "orchestrator-*": "deny",
          },
        },
      },
    },
  )

  it.instance(
    "evaluate respects task permission from config",
    () =>
      Effect.gen(function* () {
        const config = yield* load
        const ruleset = Permission.fromConfig(config.permission ?? {})
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")
        // Unspecified agents default to "ask"
        expect(Permission.evaluate("task", "unknown-agent", ruleset).action).toBe("ask")
      }),
    {
      git: true,
      config: {
        permission: {
          task: {
            general: "allow",
            "code-reviewer": "deny",
          },
        },
      },
    },
  )

  it.instance(
    "mixed permission config with task and other tools",
    () =>
      Effect.gen(function* () {
        const config = yield* load
        const ruleset = Permission.fromConfig(config.permission ?? {})

        // Verify task permissions
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // Verify other tool permissions
        expect(Permission.evaluate("bash", "*", ruleset).action).toBe("allow")
        expect(Permission.evaluate("edit", "*", ruleset).action).toBe("ask")

        // Verify disabled tools
        const disabled = Permission.disabled(["bash", "edit", "task"], ruleset)
        expect(disabled.has("bash")).toBe(false)
        expect(disabled.has("edit")).toBe(false)
        // task is NOT disabled because "general" (spec 7) has higher pattern specificity than "*" (spec 0)
        expect(disabled.has("task")).toBe(false)
      }),
    {
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
    },
  )

  it.instance(
    "task tool NOT disabled when specific patterns are allowed despite wildcard deny",
    () =>
      Effect.gen(function* () {
        const config = yield* load
        const ruleset = Permission.fromConfig(config.permission ?? {})

        // Specific patterns "general" (spec 7) and "code-reviewer" (spec 13) beat "*" (spec 0)
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("allow")
        expect(Permission.evaluate("task", "unknown", ruleset).action).toBe("deny")

        // The most specific pattern wins — "general" or "code-reviewer" beats "*"
        const disabled = Permission.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(false)
      }),
    {
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
    },
  )

  it.instance(
    "task tool NOT disabled when specific allow has higher pattern specificity",
    () =>
      Effect.gen(function* () {
        const config = yield* load
        const ruleset = Permission.fromConfig(config.permission ?? {})

        // "general" (spec 7) beats "*" (spec 0) due to higher pattern specificity
        expect(Permission.evaluate("task", "general", ruleset).action).toBe("allow")
        // Other agents without specific allow are denied
        expect(Permission.evaluate("task", "code-reviewer", ruleset).action).toBe("deny")

        // "general" (spec 7) beats "*" (spec 0) in pattern specificity too
        const disabled = Permission.disabled(["task"], ruleset)
        expect(disabled.has("task")).toBe(false)
      }),
    {
      git: true,
      config: {
        permission: {
          task: {
            "*": "deny",
            general: "allow",
          },
        },
      },
    },
  )
})
