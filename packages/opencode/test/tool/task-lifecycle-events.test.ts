import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

function ctx(input: { sessionID: SessionID; messageID: MessageID; abort: AbortSignal }) {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "build",
    abort: input.abort,
    messages: [],
    metadata: () => {},
    ask: async () => {},
    extra: { bypassAgentCheck: true },
  }
}

function fakeParent(sessionID: SessionID, messageID: MessageID, path: string) {
  return {
    info: {
      id: messageID,
      role: "assistant" as const,
      parentID: MessageID.make("msg_user"),
      sessionID,
      modelID: ref.modelID,
      providerID: ref.providerID,
      mode: "build",
      agent: "build",
      path: { cwd: path, root: path },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    },
    parts: [],
  } as any
}

test("TaskTool emits started then stopped with completed status", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const seen: Array<{ type: string; properties: any }> = []
      const offA = Bus.subscribe(Session.Event.SubagentStarted, (evt) => seen.push(evt))
      const offB = Bus.subscribe(Session.Event.SubagentStopped, (evt) => seen.push(evt))

      const parent = SessionID.descending()
      const parentMsg = MessageID.make("msg_parent")

      spyOn(MessageV2, "get").mockReturnValue(fakeParent(parent, parentMsg, tmp.path))

      spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([{ type: "text", text: "do work" }] as any)
      spyOn(SessionPrompt, "prompt").mockResolvedValue({
        info: {
          id: MessageID.make("msg_child"),
          role: "assistant" as const,
          parentID: MessageID.make("msg_user"),
          sessionID: SessionID.descending(),
          modelID: ref.modelID,
          providerID: ref.providerID,
          mode: "general",
          agent: "general",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0.42,
          tokens: { input: 11, output: 22, reasoning: 3, cache: { read: 4, write: 5 } },
          time: { created: Date.now(), completed: Date.now() + 5 },
        },
        parts: [{ type: "text", text: "done" }],
      } as any)

      const tool = await TaskTool.init({ agent: await Agent.get("build") })
      await tool.execute(
        { description: "Run subagent", prompt: "do work", subagent_type: "general" },
        ctx({ sessionID: parent, messageID: parentMsg, abort: AbortSignal.any([]) }),
      )

      await Bun.sleep(10)
      offA()
      offB()

      expect(seen).toHaveLength(2)
      expect(seen[0].type).toBe("session.subagent.started")
      expect(seen[1].type).toBe("session.subagent.stopped")
      expect(seen[1].properties.status).toBe("completed")
      expect(seen[1].properties.tokens.input).toBe(11)
      expect(seen[1].properties.cost).toBe(0.42)
      expect(seen[1].properties.sessionID).toBe(seen[0].properties.sessionID)
      expect(seen[1].properties.parentID).toBe(parent)
    },
  })
})

test("TaskTool emits stopped with failed status when prompt throws", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const seen: Array<{ type: string; properties: any }> = []
      const offA = Bus.subscribe(Session.Event.SubagentStarted, (evt) => seen.push(evt))
      const offB = Bus.subscribe(Session.Event.SubagentStopped, (evt) => seen.push(evt))

      const parent = SessionID.descending()
      const parentMsg = MessageID.make("msg_parent")

      spyOn(MessageV2, "get").mockReturnValue(fakeParent(parent, parentMsg, tmp.path))
      spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([{ type: "text", text: "do work" }] as any)
      spyOn(SessionPrompt, "prompt").mockRejectedValue(new Error("boom"))

      const tool = await TaskTool.init({ agent: await Agent.get("build") })
      await expect(
        tool.execute(
          { description: "Run subagent", prompt: "do work", subagent_type: "general" },
          ctx({ sessionID: parent, messageID: parentMsg, abort: AbortSignal.any([]) }),
        ),
      ).rejects.toThrow("boom")

      await Bun.sleep(10)
      offA()
      offB()

      expect(seen).toHaveLength(2)
      expect(seen[0].type).toBe("session.subagent.started")
      expect(seen[1].type).toBe("session.subagent.stopped")
      expect(seen[1].properties.status).toBe("failed")
      expect(seen[1].properties.error).toContain("boom")
    },
  })
})

test("TaskTool emits stopped with cancelled status when abort signal is triggered", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const seen: Array<{ type: string; properties: any }> = []
      const offA = Bus.subscribe(Session.Event.SubagentStarted, (evt) => seen.push(evt))
      const offB = Bus.subscribe(Session.Event.SubagentStopped, (evt) => seen.push(evt))

      const parent = SessionID.descending()
      const parentMsg = MessageID.make("msg_parent")
      const ctrl = new AbortController()

      spyOn(MessageV2, "get").mockReturnValue(fakeParent(parent, parentMsg, tmp.path))
      spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([{ type: "text", text: "do work" }] as any)
      spyOn(SessionPrompt, "prompt").mockImplementation(async () => {
        ctrl.abort()
        throw new Error("aborted")
      })

      const tool = await TaskTool.init({ agent: await Agent.get("build") })
      await expect(
        tool.execute(
          { description: "Run subagent", prompt: "do work", subagent_type: "general" },
          ctx({ sessionID: parent, messageID: parentMsg, abort: ctrl.signal }),
        ),
      ).rejects.toThrow()

      await Bun.sleep(10)
      offA()
      offB()

      expect(seen).toHaveLength(2)
      expect(seen[0].type).toBe("session.subagent.started")
      expect(seen[1].type).toBe("session.subagent.stopped")
      expect(seen[1].properties.status).toBe("cancelled")
      expect(seen[1].properties.error).toBeUndefined()
    },
  })
})
