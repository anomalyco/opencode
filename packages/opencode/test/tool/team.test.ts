import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { TeamTool } from "../../src/tool/team"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.team", () => {
  test("description sorts subagents by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const first = await TeamTool.init({ agent: build })
        const second = await TeamTool.init({ agent: build })

        expect(first.description).toBe(second.description)

        const alpha = first.description.indexOf("- alpha: Alpha agent")
        const explore = first.description.indexOf("- explore:")
        const general = first.description.indexOf("- general:")
        const zebra = first.description.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      },
    })
  })

  test("parameters schema validates minimum tasks", () => {
    const init = TeamTool.init()
    expect(init).resolves.toBeDefined()
  })

  test("validates duplicate task IDs", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          explore: {
            description: "Explore agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TeamTool.init({ agent: build })

        const result = tool.execute(
          {
            tasks: [
              { id: "a", description: "Task A", prompt: "Do A", subagent_type: "explore" },
              { id: "a", description: "Task B", prompt: "Do B", subagent_type: "explore" },
            ],
          },
          {} as any,
        )
        await expect(result).rejects.toThrow("Duplicate task IDs")
      },
    })
  })

  test("validates unknown dependency references", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          explore: {
            description: "Explore agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TeamTool.init({ agent: build })

        const result = tool.execute(
          {
            tasks: [
              { id: "a", description: "Task A", prompt: "Do A", subagent_type: "explore", depends: ["nonexistent"] },
            ],
          },
          {} as any,
        )
        await expect(result).rejects.toThrow('depends on unknown task "nonexistent"')
      },
    })
  })

  test("validates self-dependency", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          explore: {
            description: "Explore agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TeamTool.init({ agent: build })

        const result = tool.execute(
          {
            tasks: [
              { id: "a", description: "Task A", prompt: "Do A", subagent_type: "explore", depends: ["a"] },
            ],
          },
          {} as any,
        )
        await expect(result).rejects.toThrow('depends on itself')
      },
    })
  })

  test("validates circular dependencies", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          explore: {
            description: "Explore agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TeamTool.init({ agent: build })

        const result = tool.execute(
          {
            tasks: [
              { id: "a", description: "Task A", prompt: "Do A", subagent_type: "explore", depends: ["b"] },
              { id: "b", description: "Task B", prompt: "Do B", subagent_type: "explore", depends: ["a"] },
            ],
          },
          {} as any,
        )
        await expect(result).rejects.toThrow("Circular dependency")
      },
    })
  })

  test("rejects unknown agent type", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          explore: {
            description: "Explore agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const tool = await TeamTool.init({ agent: build })

        const result = tool.execute(
          {
            tasks: [
              { id: "a", description: "Task A", prompt: "Do A", subagent_type: "nonexistent-agent-xyz" },
            ],
          },
          {
            sessionID: "test" as any,
            messageID: "test" as any,
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => {},
            ask: async () => {},
          } as any,
        )

        const output = await result
        expect(output.output).toContain('status="failed"')
        expect(output.output).toContain("Unknown agent type")
      },
    })
  })
})
