import { test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { PermissionNext } from "../../src/permission/next"

// Helper to evaluate permission for a tool with wildcard pattern
function evalPerm(agent: Agent.Info | undefined, permission: string): PermissionNext.Action | undefined {
  if (!agent) return undefined
  return PermissionNext.evaluate(permission, "*", agent.permission).action
}

test("jules agent is available and has correct defaults", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const jules = await Agent.get("jules")
      expect(jules).toBeDefined()
      expect(jules?.mode).toBe("primary")
      expect(jules?.native).toBe(true)
      expect(jules?.prompt).toContain("You are Jules")

      // Permissions should be similar to build (full access)
      expect(evalPerm(jules, "edit")).toBe("allow")
      expect(evalPerm(jules, "bash")).toBe("allow")
      expect(evalPerm(jules, "webfetch")).toBe("allow")
    },
  })
})

test("jules agent is in the list of agents", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).toContain("jules")
    },
  })
})
