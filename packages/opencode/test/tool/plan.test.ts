import { test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import * as QuestionModule from "../../src/question"
import { PlanExitTool } from "../../src/tool/plan"

const ctx = (sessionID: string) => ({
  sessionID: sessionID as any,
  messageID: MessageID.ascending(),
  callID: "test-call",
  agent: "plan",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: async () => {},
  ask: async () => {},
})

async function seedPlanMessage(sessionID: string, model: { providerID: string; modelID: string }) {
  const msg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID: sessionID as any,
    role: "user",
    time: { created: Date.now() },
    agent: "plan",
    model: model as any,
  }
  await Session.updateMessage(msg)
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: sessionID as any,
    type: "text",
    text: "make a plan",
  } as any)
}

let askSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  askSpy = spyOn(QuestionModule.Question, "ask").mockResolvedValue([["Yes"]])
})

afterEach(() => {
  askSpy.mockRestore()
})

test("plan_exit uses agent.build.model from config when set", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      agent: {
        build: {
          model: "openai/gpt-4o",
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      await seedPlanMessage(session.id, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })

      const tool = await PlanExitTool.init()
      await tool.execute({}, ctx(session.id))

      let buildMsg: MessageV2.User | undefined
      for await (const item of MessageV2.stream(session.id as any)) {
        if (item.info.role === "user" && item.info.agent === "build") {
          buildMsg = item.info as MessageV2.User
        }
      }

      expect(buildMsg).toBeDefined()
      expect(String(buildMsg!.model.providerID)).toBe("openai")
      expect(String(buildMsg!.model.modelID)).toBe("gpt-4o")

      await Session.remove(session.id)
    },
  })
})

test("plan_exit falls back to last session model when agent.build.model is not configured", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      await seedPlanMessage(session.id, { providerID: "anthropic", modelID: "claude-3-5-sonnet" })

      const tool = await PlanExitTool.init()
      await tool.execute({}, ctx(session.id))

      let buildMsg: MessageV2.User | undefined
      for await (const item of MessageV2.stream(session.id as any)) {
        if (item.info.role === "user" && item.info.agent === "build") {
          buildMsg = item.info as MessageV2.User
        }
      }

      expect(buildMsg).toBeDefined()
      expect(String(buildMsg!.model.providerID)).toBe("anthropic")
      expect(String(buildMsg!.model.modelID)).toBe("claude-3-5-sonnet")

      await Session.remove(session.id)
    },
  })
})
