import { describe, expect, test } from "bun:test"
import { FastCheck } from "effect/testing"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "../../src/agent/agent"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import { Permission } from "../../src/permission"

// T6.1 (design-final §4.2): `deriveSubagentSessionPermission` is the SINGLE
// source of the task/todowrite auto-denies and gates them by depth: only a
// child AT the maximum nesting depth (childDepth >= maxDepth) gets the task
// deny — below the limit no auto-deny is emitted, so the default wildcard
// `'*': allow` suffices to spawn (the old `canTask` exact-match asymmetry is
// gone).

function testAgent(input: { name?: string; permission: Parameters<typeof Permission.fromConfig>[0] }): Agent.Info {
  return {
    name: input.name ?? "subject",
    mode: "subagent",
    permission: Permission.fromConfig(input.permission),
    options: {},
  } satisfies Agent.Info
}

const wildcardAgent = () => testAgent({ permission: { "*": "allow" } })

const rulesFor = (permission: string, rules: PermissionV1.Ruleset) =>
  rules.filter((rule) => rule.permission === permission)

describe("deriveSubagentSessionPermission depth gating", () => {
  test("emits no task auto-deny below the limit (childDepth 2..4 of 5)", () => {
    for (const childDepth of [2, 3, 4]) {
      const derived = deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: wildcardAgent(),
        childDepth,
        maxDepth: 5,
      })
      expect(rulesFor("task", derived)).toEqual([])
      // The runtime merge (agent ∪ session) is what the LLM request sees: a
      // wildcard-allow agent may now spawn without an exact `task` rule.
      const effective = Permission.merge(wildcardAgent().permission, derived)
      expect(Permission.evaluate("task", "general", effective).action).toBe("allow")
    }
  })

  test("denies task at the limit regardless of the agent's own config", () => {
    const permissive = testAgent({ permission: { "*": "allow", task: "allow" } })
    for (const childDepth of [5, 6]) {
      const derived = deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: permissive,
        childDepth,
        maxDepth: 5,
      })
      expect(derived).toEqual(
        expect.arrayContaining([{ permission: "task", pattern: "*", action: "deny" }]),
      )
      const effective = Permission.merge(permissive.permission, derived)
      expect(Permission.evaluate("task", "general", effective).action).toBe("deny")
    }
  })

  test("a parent session task deny stays sticky on every depth", () => {
    const parentSessionPermission: PermissionV1.Ruleset = [{ permission: "task", pattern: "*", action: "deny" }]
    for (const childDepth of [2, 3, 4, 5]) {
      const derived = deriveSubagentSessionPermission({
        parentSessionPermission,
        subagent: wildcardAgent(),
        childDepth,
        maxDepth: 5,
      })
      const effective = Permission.merge(wildcardAgent().permission, derived)
      expect(Permission.evaluate("task", "general", effective).action).toBe("deny")
    }
  })

  test("todowrite auto-deny is unchanged by depth", () => {
    for (const childDepth of [2, 5]) {
      const withoutTodo = deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: wildcardAgent(),
        childDepth,
        maxDepth: 5,
      })
      expect(rulesFor("todowrite", withoutTodo)).toEqual([{ permission: "todowrite", pattern: "*", action: "deny" }])

      const withTodo = deriveSubagentSessionPermission({
        parentSessionPermission: [],
        subagent: testAgent({ permission: { todowrite: "allow" } }),
        childDepth,
        maxDepth: 5,
      })
      expect(rulesFor("todowrite", withTodo)).toEqual([])
    }
  })

  test("parent deny and external_directory rules are inherited, plain allows are not", () => {
    const derived = deriveSubagentSessionPermission({
      parentSessionPermission: [
        { permission: "bash", pattern: "*", action: "deny" },
        { permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" },
        { permission: "edit", pattern: "*", action: "allow" },
      ],
      subagent: wildcardAgent(),
      childDepth: 2,
      maxDepth: 5,
    })
    expect(derived).toContainEqual({ permission: "bash", pattern: "*", action: "deny" })
    expect(derived).toContainEqual({ permission: "external_directory", pattern: "/tmp/allowed/*", action: "allow" })
    expect(rulesFor("edit", derived)).toEqual([])
  })

  test("kill-switch semantics: maxDepth 1 denies even the first child", () => {
    const derived = deriveSubagentSessionPermission({
      parentSessionPermission: [],
      subagent: wildcardAgent(),
      childDepth: 2,
      maxDepth: 1,
    })
    expect(derived).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
  })

  // Ü6 (design-final §6.2): deny monotonicity over 4 derivation levels — a
  // deny that holds on the session ruleset of level ≤ n can NEVER evaluate to
  // allow on level n+1. Permanent guard rail for the deny-ceiling guarantee.
  test("property: denies are monotone ceilings across 4 derivation levels", () => {
    const permissions = ["bash", "edit", "task", "read", "external_directory"] as const
    const patterns = ["*", "src/*"] as const
    const actions = ["allow", "deny", "ask"] as const
    const rule = FastCheck.record({
      permission: FastCheck.constantFrom(...permissions),
      pattern: FastCheck.constantFrom(...patterns),
      action: FastCheck.constantFrom(...actions),
    })
    const ruleset = FastCheck.array(rule, { maxLength: 8 })
    const probes = ["anything", "src/x", "general"]

    FastCheck.assert(
      FastCheck.property(ruleset, FastCheck.array(ruleset, { minLength: 4, maxLength: 4 }), (parent, agents) => {
        let current = parent as unknown as PermissionV1.Ruleset
        for (let level = 0; level < 4; level++) {
          const next = deriveSubagentSessionPermission({
            parentSessionPermission: current,
            subagent: {
              name: `level-${level + 2}`,
              mode: "subagent",
              permission: agents[level] as unknown as PermissionV1.Ruleset,
              options: {},
            } as Agent.Info,
            childDepth: level + 2,
            maxDepth: 5,
          })
          for (const permission of permissions) {
            for (const probe of probes) {
              if (Permission.evaluate(permission, probe, current).action !== "deny") continue
              expect(Permission.evaluate(permission, probe, next).action).toBe("deny")
            }
          }
          current = next
        }
      }),
      { numRuns: 100 },
    )
  })
})
