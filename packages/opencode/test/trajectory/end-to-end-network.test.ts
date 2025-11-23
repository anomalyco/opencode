import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { TrajectoryConfig } from "../../src/trajectory/config"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import type { Trajectory } from "../../src/trajectory/types"

describe("Network Trajectory Recording", () => {
  test("should record real LLM call with token usage", async () => {
    const provider = process.env.OPENCODE_NETWORK_PROVIDER
    const model = process.env.OPENCODE_NETWORK_MODEL
    if (!provider || !model) {
      test.skip("Set OPENCODE_NETWORK_PROVIDER and OPENCODE_NETWORK_MODEL to run network e2e")
      return
    }

    await using tmp = await tmpdir({ git: true, init: async (dir) => {
      const cfgPath = path.join(dir, "opencode.json")
      const cfg = {
        $schema: "https://opencode.ai/config.json",
        agent: {
          "net-agent": {
            model: `${provider}/${model}`,
            tools: {},
            description: "network test agent",
          },
        },
      }
      await Bun.write(cfgPath, JSON.stringify(cfg, null, 2))
    }})

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outDir = path.join(tmp.path, ".opencode", "trajectories")
        TrajectoryConfig.set({
          enabled: true,
          outputPath: outDir,
          filenameTemplate: "net_{sessionID}.jsonl",
        })

        const session = await Session.create({
          agent: "net-agent",
          provider,
          model,
        })

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "net-agent",
          parts: [{ type: "text", text: "Say hello in one short sentence." }],
        })

        const file = path.join(outDir, `net_${session.id}.jsonl`)
        const content = await fs.readFile(file, "utf-8")
        const lines = content.trim().split("\n")
        const events = lines.map((line) => JSON.parse(line) as Trajectory.Event)
        const interaction = events.find(
          (event) => event.type === "llm_interaction" && (event as Trajectory.LLMInteractionEvent).purpose === "agent_step",
        ) as Trajectory.LLMInteractionEvent | undefined

        expect(interaction).toBeDefined()
        expect(interaction?.response.usage.inputTokens).toBeGreaterThan(0)
        expect(interaction?.response.usage.outputTokens).toBeGreaterThan(0)
        expect(interaction?.response.usage.totalInputTokens).toBeGreaterThan(0)
        expect(interaction?.response.usage.totalOutputTokens).toBeGreaterThan(0)
      },
    })
  })
})
