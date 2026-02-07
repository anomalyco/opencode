import { describe, test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

/**
 * These tests verify that when a primary agent with permissive rules (e.g.
 * "permission": "allow") spawns a subagent via TaskTool, the parent agent's
 * permission rules propagate to the child session so the subagent inherits them.
 *
 * Without propagation, the subagent's own restrictive rules (e.g. explore's
 * "*": "deny") take effect, and any tool call that evaluates to "ask" will
 * block indefinitely in unattended/autonomous mode.
 */
describe("subagent permission propagation", () => {
  test("parent agent 'allow all' should propagate to subagent session", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          auto: {
            description: "Autonomous mode with full permissions",
            mode: "primary",
            permission: { "*": "allow" },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const autoAgent = await Agent.get("auto")
        const exploreAgent = await Agent.get("explore")
        expect(autoAgent).toBeDefined()
        expect(exploreAgent).toBeDefined()

        // Verify the parent agent allows everything
        expect(PermissionNext.evaluate("edit", "*", autoAgent!.permission).action).toBe("allow")
        expect(PermissionNext.evaluate("bash", "rm -rf /", autoAgent!.permission).action).toBe("allow")

        // Verify the explore subagent denies edit by default
        expect(PermissionNext.evaluate("edit", "*", exploreAgent!.permission).action).toBe("deny")

        // Simulate what TaskTool does: create a child session (task.ts:72-101)
        // The fix adds callingAgent.permission to the child session's permission
        // field, before the hard-coded denies.
        const parentSession = await Session.create({})
        const hasTaskPermission = exploreAgent!.permission.some((rule) => rule.permission === "task")
        const childSession = await Session.create({
          parentID: parentSession.id,
          title: "test subagent",
          permission: [
            ...autoAgent!.permission,
            { permission: "todowrite", pattern: "*", action: "deny" },
            { permission: "todoread", pattern: "*", action: "deny" },
            ...(!hasTaskPermission
              ? [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]
              : []),
          ],
        })

        // Simulate what prompt.ts:416 does: merge subagent permission + child session permission
        const effectiveRuleset = PermissionNext.merge(exploreAgent!.permission, childSession.permission ?? [])

        // The parent agent (auto) has "allow all", so the subagent should
        // inherit that. Without propagation, this evaluates to "deny" because
        // the explore agent's "*": "deny" is never overridden by the parent's
        // "*": "allow".
        const editResult = PermissionNext.evaluate("edit", "*", effectiveRuleset)
        expect(editResult.action).toBe("allow")
      },
    })
  })

  test("parent agent bash permissions should propagate to subagent session", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          auto: {
            description: "Autonomous mode with full permissions",
            mode: "primary",
            permission: { "*": "allow" },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const autoAgent = await Agent.get("auto")
        const generalAgent = await Agent.get("general")
        expect(autoAgent).toBeDefined()
        expect(generalAgent).toBeDefined()

        // Verify the parent agent allows everything
        expect(PermissionNext.evaluate("*", "*", autoAgent!.permission).action).toBe("allow")

        // general agent inherits defaults, doom_loop is "ask"
        expect(PermissionNext.evaluate("doom_loop", "*", generalAgent!.permission).action).toBe("ask")

        // Simulate TaskTool child session creation
        // The fix adds callingAgent.permission to the child session's permission
        const parentSession = await Session.create({})
        const childSession = await Session.create({
          parentID: parentSession.id,
          title: "test subagent",
          permission: [
            ...autoAgent!.permission,
            { permission: "todowrite", pattern: "*", action: "deny" },
            { permission: "todoread", pattern: "*", action: "deny" },
          ],
        })

        // Simulate prompt.ts:416 merge
        const effectiveRuleset = PermissionNext.merge(generalAgent!.permission, childSession.permission ?? [])

        // doom_loop evaluates to "ask" without parent propagation.
        // In unattended mode, this hangs forever.
        // With parent propagation, it should be "allow".
        const doomLoopResult = PermissionNext.evaluate("doom_loop", "*", effectiveRuleset)
        expect(doomLoopResult.action).toBe("allow")
      },
    })
  })

  test("hard-coded denies (todowrite, todoread, task) should still override parent allow", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          auto: {
            description: "Autonomous mode with full permissions",
            mode: "primary",
            permission: { "*": "allow" },
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const autoAgent = await Agent.get("auto")
        const exploreAgent = await Agent.get("explore")
        expect(autoAgent).toBeDefined()
        expect(exploreAgent).toBeDefined()

        // Simulate TaskTool child session creation with hard-coded denies
        // The fix adds callingAgent.permission before the hard-coded denies
        const parentSession = await Session.create({})
        const childSession = await Session.create({
          parentID: parentSession.id,
          title: "test subagent",
          permission: [
            ...autoAgent!.permission,
            { permission: "todowrite", pattern: "*", action: "deny" },
            { permission: "todoread", pattern: "*", action: "deny" },
            { permission: "task", pattern: "*", action: "deny" },
          ],
        })

        const effectiveRuleset = PermissionNext.merge(exploreAgent!.permission, childSession.permission ?? [])

        // Even with parent propagation, todowrite/todoread/task should
        // remain denied because the hard-coded denies come AFTER the
        // parent's rules in the merge (findLast wins)
        expect(PermissionNext.evaluate("todowrite", "*", effectiveRuleset).action).toBe("deny")
        expect(PermissionNext.evaluate("todoread", "*", effectiveRuleset).action).toBe("deny")
        expect(PermissionNext.evaluate("task", "*", effectiveRuleset).action).toBe("deny")
      },
    })
  })
})
