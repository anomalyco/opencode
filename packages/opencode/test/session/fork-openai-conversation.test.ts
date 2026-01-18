import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import type { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("session.fork + openai conversation state", () => {
  test("fork strips OpenAI responseId metadata", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const userMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "default",
          model: { providerID: "openai", modelID: "gpt-4" },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: userMsg.id,
          sessionID: session.id,
          type: "text",
          text: "Hello",
        })

        const assistantMsg: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          role: "assistant",
          sessionID: session.id,
          mode: "default",
          agent: "default",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "gpt-4",
          providerID: "openai",
          parentID: userMsg.id,
          time: { created: Date.now() },
          finish: "stop",
        }
        await Session.updateMessage(assistantMsg)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: assistantMsg.id,
          sessionID: session.id,
          type: "text",
          text: "Hi!",
          metadata: { openai: { responseId: "resp_123" } },
        })

        const forked = await Session.fork({ sessionID: session.id })
        const forkedMessages = await Session.messages({ sessionID: forked.id })

        const forkedAssistant = forkedMessages.find((m) => m.info.role === "assistant")!
        for (const part of forkedAssistant.parts as any[]) {
          if (!part.metadata) continue
          expect(part.metadata.openai?.responseId).toBeUndefined()
        }
      },
    })
  })
})

