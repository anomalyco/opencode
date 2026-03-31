import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { BriefTool } from "../../src/tool/brief"
import { MessageID, PartID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionPrompt } from "../../src/session/prompt"
import { ToolRegistry } from "../../src/tool/registry"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

describe("tool.brief", () => {
  test("uses latest user agent and model from current session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("old") },
          time: { created: Date.now() - 1000 },
        })
        const latest = await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          agent: "plan",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("latest") },
          time: { created: Date.now() },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: latest.id,
          sessionID: session.id,
          type: "text",
          text: "latest prompt",
        })

        const create = spyOn(SessionCompaction, "create").mockResolvedValue(undefined)
        const loop = spyOn(SessionPrompt, "loop").mockResolvedValue(
          {} as Awaited<ReturnType<typeof SessionPrompt.loop>>,
        )

        const tool = await BriefTool.init()
        const result = await tool.execute(
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

        expect(create).toHaveBeenCalledWith({
          sessionID: session.id,
          agent: "plan",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("latest") },
          auto: false,
        })
        expect(loop).toHaveBeenCalledWith({ sessionID: session.id })
        expect(result.title).toContain("Brief")
      },
    })
  })

  test("falls back to default agent and model when session has no user messages", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const def = { providerID: ProviderID.make("fallback"), modelID: ModelID.make("fallback") }
        const agent = spyOn(Agent, "defaultAgent").mockResolvedValue("build")
        const model = spyOn(Provider, "defaultModel").mockResolvedValue(def)
        const create = spyOn(SessionCompaction, "create").mockResolvedValue(undefined)
        spyOn(SessionPrompt, "loop").mockResolvedValue({} as Awaited<ReturnType<typeof SessionPrompt.loop>>)

        const tool = await BriefTool.init()
        await tool.execute(
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

        expect(agent).toHaveBeenCalledTimes(1)
        expect(model).toHaveBeenCalledTimes(1)
        expect(create).toHaveBeenCalledWith({
          sessionID: session.id,
          agent: "build",
          model: def,
          auto: false,
        })
      },
    })
  })

  test("is registered in tool registry", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("brief")
      },
    })
  })
})
