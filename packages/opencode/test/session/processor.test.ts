import { describe, expect, test, spyOn } from "bun:test"
import { Session } from "../../src/session"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"
import { LLM } from "../../src/session/llm"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.processor text streaming", () => {
  test("creates a text part when text-delta arrives before text-start", async () => {
    const streamSpy = spyOn(LLM, "stream").mockResolvedValue({
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "text-delta", text: "Hello" }
        yield { type: "text-delta", text: " world" }
        yield { type: "text-end" }
      })(),
    } as any)

    try {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const userMsg = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            agent: "default",
            model: {
              providerID: "test",
              modelID: "test-model",
            },
            time: {
              created: Date.now(),
            },
          })

          const assistantMsg: MessageV2.Assistant = {
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID: session.id,
            mode: "default",
            agent: "default",
            path: {
              cwd: tmp.path,
              root: tmp.path,
            },
            cost: 0,
            tokens: {
              output: 0,
              input: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: "test-model",
            providerID: "test",
            parentID: userMsg.id,
            time: {
              created: Date.now(),
            },
          }
          await Session.updateMessage(assistantMsg)

          const processor = SessionProcessor.create({
            assistantMessage: assistantMsg,
            sessionID: session.id,
            model: { providerID: "test", id: "test-model", api: { id: "test-model" } } as any,
            abort: new AbortController().signal,
          })

          const result = await processor.process({} as any)
          const parts = await MessageV2.parts(assistantMsg.id)
          const textParts = parts.filter((part) => part.type === "text")

          expect(result).toBe("continue")
          expect(textParts).toHaveLength(1)
          expect(textParts[0]).toMatchObject({
            type: "text",
            text: "Hello world",
          })

          await Session.remove(session.id)
        },
      })
    } finally {
      streamSpy.mockRestore()
    }
  })
})
