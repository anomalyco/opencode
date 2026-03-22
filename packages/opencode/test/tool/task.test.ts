import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { TaskTool } from "../../src/tool/task"
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

  test("parameters accept dynamic subagent model and variant inputs", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const task = await TaskTool.init({ agent: build })

        const parsed = task.parameters.parse({
          description: "Search hooks",
          prompt: "Inspect apps/studio/src/hooks for candidates.",
          subagent_type: "spark-scout",
          subagent_description: "Focused code search subagent",
          model: "openai/gpt-5.4",
          variant: "high",
          agent_config: {
            temperature: 0.2,
          },
        })

        expect(parsed.subagent_description).toBe("Focused code search subagent")
        expect(parsed.model).toBe("openai/gpt-5.4")
        expect(parsed.variant).toBe("high")
        expect(parsed.agent_config).toEqual({ temperature: 0.2 })
      },
    })
  })
})
