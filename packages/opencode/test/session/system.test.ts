import { test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import type { Agent } from "../../src/agent/agent"
import path from "path"

test("SystemPrompt.agent returns empty array when no instructions", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent: Agent.Info = {
        name: "test",
        mode: "primary",
        permission: [],
        options: {},
      }
      const result = await SystemPrompt.agent(agent)
      expect(result).toEqual([])
    },
  })
})

test("SystemPrompt.agent returns empty array when instructions is empty array", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent: Agent.Info = {
        name: "test",
        mode: "primary",
        permission: [],
        options: {},
        instructions: [],
      }
      const result = await SystemPrompt.agent(agent)
      expect(result).toEqual([])
    },
  })
})

test("SystemPrompt.agent loads instructions from absolute path", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "custom-instructions.md"), "# Custom Instructions\nAlways use Researcher agent")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent: Agent.Info = {
        name: "test",
        mode: "primary",
        permission: [],
        options: {},
        instructions: [path.join(tmp.path, "custom-instructions.md")],
      }
      const result = await SystemPrompt.agent(agent)
      expect(result.length).toBe(1)
      expect(result[0]).toContain("Instructions from:")
      expect(result[0]).toContain("custom-instructions.md")
      expect(result[0]).toContain("Always use Researcher agent")
    },
  })
})

test("SystemPrompt.agent loads instructions from relative path", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "agent-rules.md"), "# Agent Rules\nBe thorough")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent: Agent.Info = {
        name: "test",
        mode: "primary",
        permission: [],
        options: {},
        instructions: ["agent-rules.md"],
      }
      const result = await SystemPrompt.agent(agent)
      expect(result.length).toBe(1)
      expect(result[0]).toContain("Be thorough")
    },
  })
})

test("SystemPrompt.agent loads multiple instruction files", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "rules1.md"), "Rule 1: Be concise")
      await Bun.write(path.join(dir, "rules2.md"), "Rule 2: Be helpful")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent: Agent.Info = {
        name: "test",
        mode: "primary",
        permission: [],
        options: {},
        instructions: ["rules1.md", "rules2.md"],
      }
      const result = await SystemPrompt.agent(agent)
      expect(result.length).toBe(2)
      expect(result.some((r) => r.includes("Be concise"))).toBe(true)
      expect(result.some((r) => r.includes("Be helpful"))).toBe(true)
    },
  })
})

test("SystemPrompt.agent ignores non-existent files", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent: Agent.Info = {
        name: "test",
        mode: "primary",
        permission: [],
        options: {},
        instructions: ["nonexistent.md"],
      }
      const result = await SystemPrompt.agent(agent)
      // Should return empty array since file doesn't exist (empty content is filtered)
      expect(result.length).toBe(0)
    },
  })
})
