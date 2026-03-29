import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("SessionPrompt.cancel", () => {
  test("does not produce unhandled rejections", async () => {
    const rejections: unknown[] = []
    const handler = (e: unknown) => rejections.push(e)
    process.on("unhandledRejection", handler)

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
        const session = await Session.create({})

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        })

        const pending = SessionPrompt.loop({ sessionID: session.id })

        await SessionPrompt.cancel(session.id)

        await expect(pending).rejects.toThrow("Session cancelled")

        await new Promise((r) => setTimeout(r, 50))

        expect(rejections).toEqual([])
      },
    })

    process.off("unhandledRejection", handler)
  })

  test("cancel on non-existent session does not throw", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionPrompt.cancel("nonexistent" as any)
      },
    })
  })
})
