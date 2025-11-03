import { test, expect, mock } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Color } from "../../src/util/color"

test("github command uses agent color when available", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            build: { color: "#00FF00" },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await AgentSvc.get("build")
      expect(agent?.color).toBe("#00FF00")

      const agentColor = Color.hexToAnsiBold(agent?.color)
      expect(agentColor).toBe("\x1b[38;2;0;255;0m\x1b[1m")
    },
  })
})

test("github command falls back to tool color when agent has no color", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          agent: {
            build: {},
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await AgentSvc.get("build")
      expect(agent?.color).toBeUndefined()

      const agentColor = Color.hexToAnsiBold(agent?.color)
      expect(agentColor).toBeUndefined()
    },
  })
})
