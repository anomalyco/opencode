import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageID, PartID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { SnipTool } from "../../src/tool/snip"
import { ToolRegistry } from "../../src/tool/registry"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.snip", () => {
  test("compacts only parts eligible under session prune semantics", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }
        const first = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() - 3 },
        })
        const reply = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: session.id,
          parentID: first.id,
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          providerID: ref.providerID,
          modelID: ref.modelID,
          time: { created: Date.now() - 2 },
          finish: "end_turn",
        })
        const part = await Session.updatePart({
          id: PartID.ascending(),
          messageID: reply.id,
          sessionID: session.id,
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "x".repeat(200_000),
            title: "done",
            metadata: {},
            time: { start: Date.now() - 2, end: Date.now() - 2 },
          },
        })
        await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() - 1 },
        })
        await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })

        const tool = await SnipTool.init()
        const out = await tool.execute(
          {},
          {
            sessionID: session.id,
            messageID: MessageID.make("msg_tool"),
            callID: "call_tool",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        const msgs = await Session.messages({ sessionID: session.id })
        const next = msgs.flatMap((item) => item.parts).find((item) => item.type === "tool" && item.id === part.id)
        expect(next?.type).toBe("tool")
        if (next?.type === "tool" && next.state.status === "completed") {
          expect(next.state.time.compacted).toBeNumber()
        }
        expect(out.output).toContain("1")
      },
    })
  })

  test("returns no-op when current session has no eligible parts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }
        const first = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() - 1 },
        })
        const reply = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: session.id,
          parentID: first.id,
          mode: "build",
          agent: "build",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          providerID: ref.providerID,
          modelID: ref.modelID,
          time: { created: Date.now() },
          finish: "end_turn",
        })
        const part = await Session.updatePart({
          id: PartID.ascending(),
          messageID: reply.id,
          sessionID: session.id,
          type: "tool",
          callID: "call_2",
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "small",
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })

        const tool = await SnipTool.init()
        const out = await tool.execute(
          {},
          {
            sessionID: session.id,
            messageID: MessageID.make("msg_tool"),
            callID: "call_tool",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          },
        )

        const msgs = await Session.messages({ sessionID: session.id })
        const next = msgs.flatMap((item) => item.parts).find((item) => item.type === "tool" && item.id === part.id)
        expect(next?.type).toBe("tool")
        if (next?.type === "tool" && next.state.status === "completed") {
          expect(next.state.time.compacted).toBeUndefined()
        }
        expect(out.output).toContain("0")
      },
    })
  })

  test("is registered in tool registry", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("snip")
      },
    })
  })
})
