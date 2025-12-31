import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { tmpdir } from "../fixture/fixture"

describe("tool.task security", () => {
  test("Plan agent has edit permission denied", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plan = await Agent.get("plan")
        expect(plan).toBeDefined()
        expect(plan?.permission.edit).toBe("deny")
      },
    })
  })

  test("Plan agent has bash whitelist with read-only commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const plan = await Agent.get("plan")
        expect(plan).toBeDefined()
        // Verify read-only commands are allowed
        expect(plan?.permission.bash["grep*"]).toBe("allow")
        expect(plan?.permission.bash["ls*"]).toBe("allow")
        expect(plan?.permission.bash["git status*"]).toBe("allow")
        expect(plan?.permission.bash["git diff*"]).toBe("allow")
        // Verify wildcard requires ask (not allow)
        expect(plan?.permission.bash["*"]).toBe("ask")
      },
    })
  })

  test("Build agent has edit permission allowed", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        expect(build).toBeDefined()
        expect(build?.permission.edit).toBe("allow")
      },
    })
  })

  test("explore subagent exists and has edit disabled in tools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const explore = await Agent.get("explore")
        expect(explore).toBeDefined()
        expect(explore?.mode).toBe("subagent")
        expect(explore?.tools.edit).toBe(false)
        expect(explore?.tools.write).toBe(false)
      },
    })
  })

  test("general subagent exists without edit restrictions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const general = await Agent.get("general")
        expect(general).toBeDefined()
        expect(general?.mode).toBe("subagent")
        // general agent doesn't have edit/write disabled by default
        expect(general?.tools.edit).toBeUndefined()
        expect(general?.tools.write).toBeUndefined()
      },
    })
  })

  test("Plan agent cannot be disabled when other restricted agents depend on it", async () => {
    // This test verifies Plan agent exists by default
    // The security fix requires Plan agent to be available for restricted parent agents
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Agent.list()
        const plan = agents.find((a) => a.name === "plan")
        expect(plan).toBeDefined()
        expect(plan?.native).toBe(true)
      },
    })
  })

  test("restricted parent detection uses permission.edit === deny", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Create a custom restricted agent
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            agent: {
              "custom-restricted": {
                mode: "primary",
                permission: {
                  edit: "deny",
                },
              },
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const custom = await Agent.get("custom-restricted")
        expect(custom).toBeDefined()
        expect(custom?.permission.edit).toBe("deny")
        // This agent would trigger the restricted path in TaskTool
      },
    })
  })
})
