import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { Identifier } from "../../src/id/id"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.removePart", () => {
  test("should remove a part and emit PartRemoved event", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const userMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test" },
        })

        const part = await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: userMsg.id,
          type: "text",
          text: "test text",
        })

        let eventReceived = false
        let removedPartID: string | undefined

        const unsub = Bus.subscribe(MessageV2.Event.PartRemoved, (event) => {
          eventReceived = true
          removedPartID = event.properties.partID
        })

        await Session.removePart({
          sessionID: session.id,
          messageID: userMsg.id,
          partID: part.id,
        })

        await new Promise((resolve) => setTimeout(resolve, 50))

        unsub()

        expect(eventReceived).toBe(true)
        expect(removedPartID).toBe(part.id)

        await Session.remove(session.id)
      },
    })
  })

  test("should update a part with compacted timestamp", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const assistantMsg = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          parentID: "parent",
          time: { created: Date.now() },
          modelID: "test",
          providerID: "test",
          mode: "build",
          path: { cwd: projectRoot, root: projectRoot },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        const toolPart: MessageV2.ToolPart = {
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistantMsg.id,
          type: "tool",
          callID: "call_123",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "/test.ts" },
            output: "original output content that is very long...",
            title: "Read test.ts",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        }

        await Session.updatePart(toolPart)

        // Update with compacted output
        const compactedPart: MessageV2.ToolPart = {
          ...toolPart,
          state: {
            ...toolPart.state,
            status: "completed",
            input: toolPart.state.input,
            output: "[Compacted]",
            title: "Read test.ts",
            metadata: {},
            time: {
              start: toolPart.state.status === "completed" ? toolPart.state.time.start : Date.now(),
              end: Date.now(),
              compacted: Date.now(),
            },
          },
        }

        const updated = await Session.updatePart(compactedPart)

        expect(updated.type).toBe("tool")
        if (updated.type === "tool" && updated.state.status === "completed") {
          expect(updated.state.output).toBe("[Compacted]")
          expect(updated.state.time.compacted).toBeDefined()
        }

        await Session.remove(session.id)
      },
    })
  })
})
