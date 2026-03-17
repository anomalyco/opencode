import { describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"

Log.init({ print: false })

describe("session.pinMessage", () => {
  test("pins a user message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const userMessage = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
        } as MessageV2.User)

        const pinned = await Session.pinMessage({
          sessionID: session.id,
          messageID: userMessage.id,
          pinned: true,
        })

        expect(pinned.pinned).toBe(true)
        expect(pinned.id).toBe(userMessage.id)
      },
    })
  })

  test("unpins a user message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const userMessage = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
          pinned: true,
        } as MessageV2.User)

        const unpinned = await Session.pinMessage({
          sessionID: session.id,
          messageID: userMessage.id,
          pinned: false,
        })

        expect(unpinned.pinned).toBe(false)
      },
    })
  })

  test("throws error when pinning assistant message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const assistantMessage = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          sessionID: session.id,
          parentID: Identifier.ascending("message"),
          time: { created: Date.now() },
          agent: "test",
          modelID: "test",
          providerID: "test",
          mode: "test",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } as MessageV2.Assistant)

        await expect(
          Session.pinMessage({
            sessionID: session.id,
            messageID: assistantMessage.id,
            pinned: true,
          }),
        ).rejects.toThrow("Only user messages can be pinned")
      },
    })
  })
})

describe("session.compaction with pinned messages", () => {
  test("includes pinned messages in compaction prompt", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const pinnedMessage = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
          pinned: true,
        } as MessageV2.User)

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: pinnedMessage.id,
          sessionID: session.id,
          type: "text",
          text: "This is a pinned message with important context",
        } as MessageV2.TextPart)

        const regularMessage = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() + 1 },
          agent: "test",
          model: { providerID: "test", modelID: "test" },
        } as MessageV2.User)

        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: regularMessage.id,
          sessionID: session.id,
          type: "text",
          text: "This is a regular message",
        } as MessageV2.TextPart)

        const messages = await Session.messages({ sessionID: session.id })
        expect(messages.length).toBe(2)
        expect((messages[0].info as MessageV2.User).pinned).toBe(true)
      },
    })
  })
})
