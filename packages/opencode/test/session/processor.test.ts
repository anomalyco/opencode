import { describe, expect, test } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Storage } from "../../src/storage/storage"
import { Identifier } from "../../src/id/id"
import path from "path"
import { MessageV2 } from "../../src/session/message-v2"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("SessionProcessor", () => {
  describe("no-response handling", () => {
    test("should end processing early for no-response messages", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})
          const assistantMessage = MessageV2.Assistant.parse({
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID: session.id,
            time: { created: Date.now() },
            parentID: session.id,
            modelID: "test",
            providerID: "test",
            mode: "test",
            path: { cwd: projectRoot, root: projectRoot },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          })
          await Storage.write(
            ["session", Instance.project.id, session.id, "message", assistantMessage.id],
            assistantMessage,
          )

          const processor = SessionProcessor.create({
            assistantMessage,
            sessionID: session.id,
            providerID: "test",
            model: { id: "test", provider: "test" } as any,
            abort: new AbortController().signal,
          })

          const mockStream = () =>
            ({
              fullStream: (async function* () {
                yield { type: "text-start" }
                yield { type: "text-delta", text: "No response requested." }
                yield { type: "text-end" }
                yield { type: "finish" }
              })(),
            }) as any

          await processor.process(mockStream)

          const messages = await Session.messages({ sessionID: session.id })
          const assistantMsg = messages.find((m) => m.info.role === "assistant")
          expect(assistantMsg?.parts).toHaveLength(1)
          expect(assistantMsg?.parts[0]?.type).toBe("text")
          if (assistantMsg?.parts[0]?.type === "text") {
            expect(assistantMsg.parts[0].text).toBe("No response requested.")
          }

          await Session.remove(session.id)
        },
      })
    })

    test("should process normal messages normally", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})
          const assistantMessage = MessageV2.Assistant.parse({
            id: Identifier.ascending("message"),
            role: "assistant",
            sessionID: session.id,
            time: { created: Date.now() },
            parentID: session.id,
            modelID: "test",
            providerID: "test",
            mode: "test",
            path: { cwd: projectRoot, root: projectRoot },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          })
          await Storage.write(
            ["session", Instance.project.id, session.id, "message", assistantMessage.id],
            assistantMessage,
          )

          const processor = SessionProcessor.create({
            assistantMessage,
            sessionID: session.id,
            providerID: "test",
            model: { id: "test", provider: "test" } as any,
            abort: new AbortController().signal,
          })

          const mockStream = () =>
            ({
              fullStream: (async function* () {
                yield { type: "text-start" }
                yield { type: "text-delta", text: "Here is a helpful response." }
                yield { type: "text-end" }
                yield { type: "finish" }
              })(),
            }) as any

          await processor.process(mockStream)

          const messages = await Session.messages({ sessionID: session.id })
          const assistantMsg = messages.find((m) => m.info.role === "assistant")
          expect(assistantMsg?.parts).toHaveLength(1)
          expect(assistantMsg?.parts[0]?.type).toBe("text")
          if (assistantMsg?.parts[0]?.type === "text") {
            expect(assistantMsg.parts[0].text).toBe("Here is a helpful response.")
          }

          await Session.remove(session.id)
        },
      })
    })
  })
})
