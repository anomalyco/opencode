import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.command /cd", () => {
  test("moves the session to the new directory and stores the exchange", async () => {
    await using root = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })
    await using next = await tmpdir({ git: true })

    await Instance.provide({
      directory: root.path,
      fn: async () => {
        const session = await Session.create({})
        const prev = Instance.project.id

        const result = await SessionPrompt.command({
          sessionID: session.id,
          command: "cd",
          arguments: next.path,
          agent: "build",
        })
        if (result.info.role !== "assistant") throw new Error("expected assistant message")

        const info = await Session.get(session.id)
        const messages = await MessageV2.get({
          sessionID: session.id,
          messageID: result.info.id,
        })

        expect(info.directory).toBe(next.path)
        expect(info.projectID).toBe(Instance.project.id)
        expect(info.projectID).not.toBe(prev)
        expect(Instance.directory).toBe(next.path)
        expect(result.info.path.cwd).toBe(next.path)
        expect(messages.parts.some((part) => part.type === "text" && part.text.includes(next.path))).toBe(true)
      },
    })
  })
})
