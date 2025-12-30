import { test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"

test("loads built-in agents when no custom agents configured", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const names = agents.map((a) => a.name)
      expect(names).toContain("build")
      expect(names).toContain("plan")
    },
  })
})

test("custom subagent works alongside built-in primary agents", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      await fs.mkdir(opencodeDir, { recursive: true })
      const agentDir = path.join(opencodeDir, "agent")
      await fs.mkdir(agentDir, { recursive: true })

      await Bun.write(
        path.join(agentDir, "helper.md"),
        `---
model: test/model
mode: subagent
---
Helper subagent prompt`,
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const helper = agents.find((a) => a.name === "helper")
      expect(helper).toBeDefined()
      expect(helper?.mode).toBe("subagent")

      // Built-in primary agents should still exist
      const build = agents.find((a) => a.name === "build")
      expect(build).toBeDefined()
      expect(build?.mode).toBe("primary")
    },
  })
})

test("throws error when all primary agents are disabled", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            build: { disable: true },
            plan: { disable: true },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        await Agent.list()
        expect(true).toBe(false) // should not reach here
      } catch (e: any) {
        expect(e.data?.message).toContain("No primary agents are available")
      }
    },
  })
})

test("does not throw when at least one primary agent remains", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            build: { disable: true },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const plan = agents.find((a) => a.name === "plan")
      expect(plan).toBeDefined()
      expect(plan?.mode).toBe("primary")
    },
  })
})

test("custom primary agent satisfies requirement when built-ins disabled", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const opencodeDir = path.join(dir, ".opencode")
      await fs.mkdir(opencodeDir, { recursive: true })
      const agentDir = path.join(opencodeDir, "agent")
      await fs.mkdir(agentDir, { recursive: true })

      await Bun.write(
        path.join(agentDir, "custom.md"),
        `---
model: test/model
mode: primary
---
Custom primary agent`,
      )

      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            build: { disable: true },
            plan: { disable: true },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await Agent.list()
      const custom = agents.find((a) => a.name === "custom")
      expect(custom).toBeDefined()
      expect(custom?.mode).toBe("primary")
    },
  })
})
