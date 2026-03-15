import { expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

test("SessionPrompt.resolveCommandModel uses assigned subagent model for input.agent subtasks", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      subagent_model_assignments: {
        general: "openai/gpt-4.1",
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      const model = await SessionPrompt.resolveCommandModel({
        sessionID: session.id,
        command: {},
        agent: "general",
        model: "opencode/kimi-k2.5-free",
      })

      expect(model).toEqual({ providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4.1") })

      await Session.remove(session.id)
    },
  })
})

test("SessionPrompt.resolveCommandModel keeps explicit model for primary input.agent commands", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      agent: {
        build: {
          model: "anthropic/claude-3.5-sonnet",
        },
      },
      subagent_model_assignments: {
        build: "openai/gpt-4.1",
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      const model = await SessionPrompt.resolveCommandModel({
        sessionID: session.id,
        command: {},
        agent: "build",
        model: "opencode/kimi-k2.5-free",
      })

      expect(model).toEqual({ providerID: ProviderID.make("opencode"), modelID: ModelID.make("kimi-k2.5-free") })

      await Session.remove(session.id)
    },
  })
})
