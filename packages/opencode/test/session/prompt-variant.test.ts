import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { tmpdir } from "../fixture/fixture"

function sessionCreate(input?: Session.CreateInput) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.create(input)))
}

function sessionRemove(id: Session.Info["id"]) {
  return AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(id)))
}

function sessionPrompt(input: SessionPrompt.PromptInput) {
  return AppRuntime.runPromise(SessionPrompt.Service.use((svc) => svc.prompt(input)))
}

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await sessionCreate({})

          const other = await sessionPrompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: ProviderID.make("opencode"), modelID: ModelID.make("kimi-k2.5-free") },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.model.variant).toBeUndefined()

          const match = await sessionPrompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model.providerID).toEqual(ProviderID.make("openai"))
          expect(match.info.model.modelID).toEqual(ModelID.make("gpt-5.2"))
          expect(match.info.model.variant).toBe("xhigh")

          const override = await sessionPrompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.model.variant).toBe("high")

          await sessionRemove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})
