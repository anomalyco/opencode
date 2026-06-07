import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Session } from "@/session/session"
import { SessionReadTool } from "@/tool/session-read"
import { SessionTailTool } from "@/tool/session-tail"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Database } from "@opencode-ai/core/database/database"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config } from "@/config/config"
import { ToolRegistry } from "@/tool/registry"
import { testEffect } from "../lib/effect"
import type * as Tool from "@/tool/tool"
import { disposeAllInstances } from "../fixture/fixture"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  EventV2Bridge.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  Truncate.defaultLayer,
  ToolRegistry.defaultLayer,
  Database.defaultLayer,
  RuntimeFlags.defaultLayer,
)

const it = testEffect(layer)

function ctx(sessionID?: string, messageID?: string): Tool.Context {
  return {
    sessionID: SessionID.make(sessionID ?? "ses_test"),
    messageID: MessageID.make(messageID ?? "msg_test"),
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

function seedText(
  session: Session.Interface,
  sessionID: SessionID,
  messageID: MessageID,
  text: string,
) {
  return session.updatePart({
    id: PartID.ascending(),
    messageID,
    sessionID,
    type: "text" as const,
    text,
  })
}

describe("tool.session_read", () => {
  it.instance("reads session messages", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "Read Test" })

      const user1 = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user" as const,
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: 1000 },
      })
      yield* seedText(session, chat.id, user1.id, "First message")

      const asst1 = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "assistant" as const,
        sessionID: chat.id,
        mode: "default" as const,
        agent: "build",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        parentID: user1.id,
        time: { created: 2000 },
        finish: "end_turn" as const,
      })
      yield* seedText(session, chat.id, asst1.id, "First response")

      const user2 = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user" as const,
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: 3000 },
      })
      yield* seedText(session, chat.id, user2.id, "Second message")

      const tool = yield* SessionReadTool
      const def = yield* tool.init()
      const result = yield* def.execute({ sessionId: chat.id }, ctx())

      const parsed = JSON.parse(result.output)
      expect(parsed.sessionId).toBe(chat.id)
      expect(parsed.messages).toHaveLength(3)
      expect(parsed.hasMore).toBe(false)
      expect(parsed.messages[0].content).toBe("First message")
      expect(parsed.messages[1].content).toBe("First response")
      expect(parsed.messages[2].content).toBe("Second message")
    }),
  )

  it.instance("includes file metadata", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "File Test" })

      const userMsg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user" as const,
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: userMsg.id,
        sessionID: chat.id,
        type: "file" as const,
        mime: "image/png",
        url: "https://example.com/img.png",
        filename: "screenshot.png",
      } as any)

      const tool = yield* SessionReadTool
      const def = yield* tool.init()
      const result = yield* def.execute({ sessionId: chat.id }, ctx())

      const parsed = JSON.parse(result.output)
      expect(parsed.messages).toHaveLength(1)
      const files = parsed.messages[0].files
      expect(files).toHaveLength(1)
      expect(files[0].mime).toBe("image/png")
      expect(files[0].url).toBe("https://example.com/img.png")
      expect(files[0].filename).toBe("screenshot.png")
    }),
  )

  it.instance("withToolOutputs: true includes tool details", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "Tool Test" })

      const assistantMsg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "assistant" as const,
        sessionID: chat.id,
        mode: "default" as const,
        agent: "build",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        parentID: MessageID.ascending(),
        time: { created: Date.now() },
        finish: "end_turn" as const,
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistantMsg.id,
        sessionID: chat.id,
        type: "tool" as const,
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed" as const,
          input: { path: "/test/file.txt" },
          output: "file content",
          title: "",
          metadata: {},
          time: { start: Date.now(), end: Date.now() + 100 },
        },
      } as any)

      const tool = yield* SessionReadTool
      const def = yield* tool.init()
      const result = yield* def.execute({ sessionId: chat.id, withToolOutputs: true }, ctx())

      const parsed = JSON.parse(result.output)
      expect(parsed.messages).toHaveLength(1)
      const toolCalls = parsed.messages[0].toolCalls
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].callID).toBe("call_1")
      expect(toolCalls[0].tool).toBe("read")
      expect(toolCalls[0].status).toBe("completed")
      expect(toolCalls[0].input).toEqual({ path: "/test/file.txt" })
      expect(toolCalls[0].output).toBe("file content")
    }),
  )

  it.instance("withToolOutputs: false excludes tool details", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "Tool Test 2" })

      const assistantMsg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "assistant" as const,
        sessionID: chat.id,
        mode: "default" as const,
        agent: "build",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        parentID: MessageID.ascending(),
        time: { created: Date.now() },
        finish: "end_turn" as const,
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistantMsg.id,
        sessionID: chat.id,
        type: "tool" as const,
        callID: "call_2",
        tool: "grep",
        state: {
          status: "completed" as const,
          input: { pattern: "error" },
          output: "line 42: Error found",
          title: "",
          metadata: {},
          time: { start: Date.now(), end: Date.now() + 100 },
        },
      } as any)

      const tool = yield* SessionReadTool
      const def = yield* tool.init()
      const result = yield* def.execute({ sessionId: chat.id, withToolOutputs: false }, ctx())

      const parsed = JSON.parse(result.output)
      expect(parsed.messages).toHaveLength(1)
      const toolCalls = parsed.messages[0].toolCalls
      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0].callID).toBe("call_2")
      expect(toolCalls[0].tool).toBe("grep")
      expect(toolCalls[0].status).toBe("completed")
      expect(toolCalls[0].input).toBeUndefined()
      expect(toolCalls[0].output).toBeUndefined()
    }),
  )

  it.instance("pagination with limit", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "Pagination Test" })

      for (let i = 0; i < 10; i++) {
        const msg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user" as const,
          sessionID: chat.id,
          agent: "build",
          model: ref,
          time: { created: 1000 + i * 100 },
        })
        yield* seedText(session, chat.id, msg.id, `Message ${i}`)
      }

      const tool = yield* SessionReadTool
      const def = yield* tool.init()
      const result = yield* def.execute({ sessionId: chat.id, limit: 3 }, ctx())

      const parsed = JSON.parse(result.output)
      expect(parsed.messages).toHaveLength(3)
      expect(parsed.hasMore).toBe(true)
      expect(parsed.messages[0].content).toBe("Message 0")
      expect(parsed.messages[1].content).toBe("Message 1")
      expect(parsed.messages[2].content).toBe("Message 2")
    }),
  )

  it.effect("session not found", () =>
    Effect.gen(function* () {
      const tool = yield* SessionReadTool
      const def = yield* tool.init()
      const exit = yield* def
        .execute({ sessionId: "ses_nonexistent" }, ctx("ses_nonexistent"))
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})

describe("tool.session_tail", () => {
  it.instance("returns most recent messages", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "Tail Test" })

      for (let i = 0; i < 10; i++) {
        const msg = yield* session.updateMessage({
          id: MessageID.ascending(),
          role: "user" as const,
          sessionID: chat.id,
          agent: "build",
          model: ref,
          time: { created: 1000 + i * 100 },
        })
        yield* seedText(session, chat.id, msg.id, `Msg ${i}`)
      }

      const tool = yield* SessionTailTool
      const def = yield* tool.init()
      const result = yield* def.execute({ sessionId: chat.id, limit: 3 }, ctx())

      const parsed = JSON.parse(result.output)
      expect(parsed).toHaveLength(3)
      expect(parsed[0].text).toBe("Msg 9")
      expect(parsed[1].text).toBe("Msg 8")
      expect(parsed[2].text).toBe("Msg 7")
    }),
  )

  it.instance("text-only output", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "Tail Text Test" })

      const assistantMsg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "assistant" as const,
        sessionID: chat.id,
        mode: "default" as const,
        agent: "build",
        path: { cwd: "/tmp/test", root: "/tmp/test" },
        cost: 0,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        parentID: MessageID.ascending(),
        time: { created: Date.now() },
        finish: "end_turn" as const,
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistantMsg.id,
        sessionID: chat.id,
        type: "text" as const,
        text: "Visible text",
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistantMsg.id,
        sessionID: chat.id,
        type: "tool" as const,
        callID: "call_3",
        tool: "bash",
        state: {
          status: "completed" as const,
          input: { command: "ls" },
          output: "file1 file2",
          title: "",
          metadata: {},
          time: { start: Date.now(), end: Date.now() + 100 },
        },
      } as any)

      const tool = yield* SessionTailTool
      const def = yield* tool.init()
      const result = yield* def.execute({ sessionId: chat.id, limit: 3 }, ctx())

      const parsed = JSON.parse(result.output)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].text).toBe("Visible text")
      expect(parsed[0].text).not.toContain("file1")
    }),
  )

  it.effect("session not found", () =>
    Effect.gen(function* () {
      const tool = yield* SessionTailTool
      const def = yield* tool.init()
      const exit = yield* def
        .execute({ sessionId: "ses_nonexistent" }, ctx("ses_nonexistent"))
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
