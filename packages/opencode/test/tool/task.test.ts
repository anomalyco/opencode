import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { TaskTool, resolveAgentType } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task", () => {
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
        const first = await TaskTool.init({ agent: build })
        const second = await TaskTool.init({ agent: build })

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
})

describe("resolveAgentType", () => {
  test("returns subagent_type when provided", () => {
    const result = resolveAgentType({
      description: "test",
      prompt: "test",
      subagent_type: "Engineer",
    })
    expect(result).toBe("Engineer")
  })

  test("falls back to agent when subagent_type is missing", () => {
    const result = resolveAgentType({
      description: "test",
      prompt: "test",
      agent: "Engineer",
    })
    expect(result).toBe("Engineer")
  })

  test("falls back to agent_type when subagent_type and agent are missing", () => {
    const result = resolveAgentType({
      description: "test",
      prompt: "test",
      agent_type: "Engineer",
    })
    expect(result).toBe("Engineer")
  })

  test("prefers subagent_type over agent and agent_type", () => {
    const result = resolveAgentType({
      description: "test",
      prompt: "test",
      subagent_type: "Architect",
      agent: "Engineer",
      agent_type: "Designer",
    })
    expect(result).toBe("Architect")
  })

  test("prefers agent over agent_type when subagent_type is missing", () => {
    const result = resolveAgentType({
      description: "test",
      prompt: "test",
      agent: "Engineer",
      agent_type: "Designer",
    })
    expect(result).toBe("Engineer")
  })

  test("throws when no agent parameter is provided", () => {
    expect(() =>
      resolveAgentType({
        description: "test",
        prompt: "test",
      }),
    ).toThrow("One of subagent_type, agent, or agent_type is required")
  })
})
