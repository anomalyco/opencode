import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { tmpdir } from "../fixture/fixture"

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
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
        const session = await Session.create({})

        const other = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: "opencode", modelID: "kimi-k2.5-free" },
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })
        if (other.info.role !== "user") throw new Error("expected user message")
        expect(other.info.variant).toBeUndefined()

        const match = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello again" }],
        })
        if (match.info.role !== "user") throw new Error("expected user message")
        expect(match.info.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
        expect(match.info.variant).toBe("xhigh")

        const override = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          variant: "high",
          parts: [{ type: "text", text: "hello third" }],
        })
        if (override.info.role !== "user") throw new Error("expected user message")
        expect(override.info.variant).toBe("high")

        await Session.remove(session.id)
      },
    })
  })
})
