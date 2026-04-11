import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { ToolRegistry } from "../../src/tool/registry"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    ToolRegistry.defaultLayer,
    Bus.layer,
  ),
)

const seed = Effect.fn("seed")(function* (title = "Pinned") {
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({ title })
  const user = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* sessions.updateMessage(assistant)
  return { chat, assistant }
})

function reply(input: Parameters<typeof SessionPrompt.prompt>[0], text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0.42,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 11, output: 22, reasoning: 3, cache: { read: 4, write: 5 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function stubOps(opts?: { text?: string; fail?: Error; abort?: AbortController }): TaskPromptOps {
  return {
    cancel() {},
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.gen(function* () {
        if (opts?.abort) {
          opts.abort.abort()
          return yield* Effect.fail(new Error("aborted"))
        }
        if (opts?.fail) return yield* Effect.fail(opts.fail)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

describe("tool.task lifecycle events", () => {
  it.live("emits started then stopped with completed status", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const bus = yield* Bus.Service
        const seen: Array<{ type: string; properties: any }> = []
        const offA = yield* bus.subscribeCallback(Session.Event.SubagentStarted, (e) => seen.push(e))
        const offB = yield* bus.subscribeCallback(Session.Event.SubagentStopped, (e) => seen.push(e))

        const tool = yield* TaskTool
        const def = yield* Effect.promise(() => tool.init())

        yield* def.execute(
          { description: "Run subagent", prompt: "do work", subagent_type: "general" },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps({ text: "result text" }), bypassAgentCheck: true },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        offA()
        offB()

        expect(seen).toHaveLength(2)
        expect(seen[0].type).toBe("session.subagent.started")
        expect(seen[1].type).toBe("session.subagent.stopped")
        expect(seen[1].properties.status).toBe("completed")
        expect(seen[1].properties.parentID).toBe(chat.id)
        expect(seen[1].properties.tokens.input).toBe(11)
        expect(seen[1].properties.cost).toBe(0.42)
        expect(seen[1].properties.sessionID).toBe(seen[0].properties.sessionID)
      }),
    ),
  )

  it.live("emits stopped with failed status when prompt fails", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const bus = yield* Bus.Service
        const seen: Array<{ type: string; properties: any }> = []
        const offA = yield* bus.subscribeCallback(Session.Event.SubagentStarted, (e) => seen.push(e))
        const offB = yield* bus.subscribeCallback(Session.Event.SubagentStopped, (e) => seen.push(e))

        const tool = yield* TaskTool
        const def = yield* Effect.promise(() => tool.init())

        yield* def
          .execute(
            { description: "Run subagent", prompt: "do work", subagent_type: "general" },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps: stubOps({ fail: new Error("boom") }), bypassAgentCheck: true },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        yield* Effect.sleep("10 millis")
        offA()
        offB()

        expect(seen).toHaveLength(2)
        expect(seen[0].type).toBe("session.subagent.started")
        expect(seen[1].type).toBe("session.subagent.stopped")
        expect(seen[1].properties.status).toBe("failed")
        expect(seen[1].properties.error).toContain("boom")
      }),
    ),
  )

  it.live("emits stopped with cancelled status when abort signal fires", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const bus = yield* Bus.Service
        const seen: Array<{ type: string; properties: any }> = []
        const offA = yield* bus.subscribeCallback(Session.Event.SubagentStarted, (e) => seen.push(e))
        const offB = yield* bus.subscribeCallback(Session.Event.SubagentStopped, (e) => seen.push(e))
        const ctrl = new AbortController()

        const tool = yield* TaskTool
        const def = yield* Effect.promise(() => tool.init())

        yield* def
          .execute(
            { description: "Run subagent", prompt: "do work", subagent_type: "general" },
            {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: ctrl.signal,
              extra: { promptOps: stubOps({ abort: ctrl }), bypassAgentCheck: true },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        yield* Effect.sleep("10 millis")
        offA()
        offB()

        expect(seen).toHaveLength(2)
        expect(seen[0].type).toBe("session.subagent.started")
        expect(seen[1].type).toBe("session.subagent.stopped")
        expect(seen[1].properties.status).toBe("cancelled")
        expect(seen[1].properties.error).toBeUndefined()
      }),
    ),
  )
})
