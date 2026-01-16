import { test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { resolveImplementationAgent } from "../../src/tool/plan"

test("resolveImplementationAgent returns build when build exists", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const target = await resolveImplementationAgent()
      expect(target).toBe("build")
    },
  })
})

test("resolveImplementationAgent returns default_agent when build disabled", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "myagent",
      agent: {
        build: { disable: true },
        myagent: { mode: "primary" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeUndefined()
      const target = await resolveImplementationAgent()
      expect(target).toBe("myagent")
    },
  })
})

test("resolveImplementationAgent falls back to first visible primary when build disabled and no default_agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { disable: true },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeUndefined()
      const target = await resolveImplementationAgent()
      // plan is the next native primary, but we prefer non-plan if possible
      // Since only plan is left as primary visible, it should return plan
      expect(target).toBe("plan")
    },
  })
})

test("resolveImplementationAgent prefers non-plan custom agent over plan", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "custom",
      agent: {
        build: { disable: true },
        custom: { mode: "primary" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const build = await Agent.get("build")
      expect(build).toBeUndefined()
      const target = await resolveImplementationAgent()
      expect(target).toBe("custom")
    },
  })
})

test("resolveImplementationAgent skips subagent when selecting fallback", async () => {
  await using tmp = await tmpdir({
    config: {
      default_agent: "explore", // subagent - should be skipped
      agent: {
        build: { disable: true },
        myimpl: { mode: "primary" },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const target = await resolveImplementationAgent()
      // explore is subagent, so it should fallback to myimpl or plan
      expect(["myimpl", "plan"]).toContain(target)
    },
  })
})
