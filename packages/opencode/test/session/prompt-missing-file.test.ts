import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
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

describe("session.prompt missing file", () => {
  test("does not fail the prompt when a file part is missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await sessionCreate({})

        const missing = path.join(tmp.path, "does-not-exist.ts")
        const msg = await sessionPrompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "please review @does-not-exist.ts" },
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "does-not-exist.ts",
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const hasFailure = msg.parts.some(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
        )
        expect(hasFailure).toBe(true)

        await sessionRemove(session.id)
      },
    })
  })
})
