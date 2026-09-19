import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import path from "path"
import type { ModelMessage } from "ai"
import type { Agent } from "../../src/agent/agent"
import { Provider } from "@/provider/provider"

import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LLMEvent } from "@opencode-ai/llm"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

const root = LayerNode.group([
  SessionProcessor.node,
  Session.node,
  SessionProjector.node,
  Provider.node,
  Database.node,
  EventV2Bridge.node,
  SessionStatus.node,
  CrossSpawnSpawner.node,
])
const replacements = [
  [SessionSummary.node, summary],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
] as const

const staleMessage = "reasoning `encrypted_content` was not issued to this caller"

type Script =
  | { type: "fail"; message: string }
  | { type: "text"; text: string }
  | { type: "partial"; text: string; message: string }

const harness = {
  queue: [] as Script[],
  captured: [] as ModelMessage[][],
  reset(scripts: Script[]) {
    this.queue = [...scripts]
    this.captured = []
  },
}

const textEvents = (text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-1" }),
  LLMEvent.textDelta({ id: "text-1", text }),
  LLMEvent.textEnd({ id: "text-1" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const partialEvents = (text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-1" }),
  LLMEvent.textDelta({ id: "text-1", text }),
]

const staleLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: (input): Stream.Stream<LLMEvent, unknown> => {
      harness.captured.push(JSON.parse(JSON.stringify(input.messages)) as ModelMessage[])
      const script = harness.queue.shift()
      if (!script) return Stream.empty
      if (script.type === "fail") return Stream.fail(new Error(script.message))
      if (script.type === "text") return Stream.make(...textEvents(script.text))
      return Stream.concat(Stream.make(...partialEvents(script.text)), Stream.fail(new Error(script.message)))
    },
  }),
)

const env = LayerNode.compile(root, [...replacements, [LLM.node, staleLLM]])
const it = testEffect(env)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  directory: string,
) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

const reasoningMessages = (): LLM.StreamInput["messages"] => [
  { role: "user", content: "Think first" },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "Encrypted thought",
        providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
      },
    ],
  },
]

const input = (
  chat: { id: SessionID },
  parent: SessionV1.User,
  model: Provider.Model,
  messages: LLM.StreamInput["messages"],
): LLM.StreamInput => ({
  user: parent,
  sessionID: chat.id,
  model,
  agent: agent(),
  system: [],
  messages,
  tools: {},
})

it.live("processor recovers once from stale encrypted reasoning and strips the replay", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "Think first")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: chat.id,
          type: "reasoning",
          text: "Encrypted thought",
          time: { start: Date.now() },
          metadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
        })
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
        const messages = reasoningMessages()
        harness.reset([{ type: "fail", message: staleMessage }, { type: "text", text: "Recovered" }])

        const result = yield* handle.process(input(chat, parent, mdl, messages))

        const parts = yield* MessageV2.parts(msg.id)
        const reasoning = parts.find((part) => part.type === "reasoning")
        const text = parts.find((part): part is SessionV1.TextPart => part.type === "text")
        expect(result).toBe("continue")
        expect(harness.captured).toHaveLength(2)
        expect(harness.captured[0]?.[1]?.content).toEqual([
          {
            type: "reasoning",
            text: "Encrypted thought",
            providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
          },
        ])
        expect(harness.captured[1]?.[1]?.content).toEqual([{ type: "reasoning", text: "Encrypted thought" }])
        expect(reasoning?.metadata?.openai).toBeUndefined()
        expect(text?.text).toBe("Recovered")
      }),
    { config: cfg },
  ),
)

it.live("processor surfaces the stale reasoning error after exactly one retry", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "Think first")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
        harness.reset([{ type: "fail", message: staleMessage }, { type: "fail", message: staleMessage }])

        const result = yield* handle.process(input(chat, parent, mdl, reasoningMessages()))

        const state = yield* (yield* SessionStatus.Service).get(chat.id)
        expect(result).toBe("stop")
        expect(harness.captured).toHaveLength(2)
        expect(handle.message.error).toBeDefined()
        expect(state).toMatchObject({ type: "idle" })
      }),
    { config: cfg },
  ),
)

it.live("processor does not recover or strip once assistant output has started", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "Think first")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
        harness.reset([{ type: "partial", text: "Partial answer", message: staleMessage }])

        const result = yield* handle.process(input(chat, parent, mdl, reasoningMessages()))

        const parts = yield* MessageV2.parts(msg.id)
        const text = parts.find((part): part is SessionV1.TextPart => part.type === "text")
        expect(result).toBe("stop")
        expect(harness.captured).toHaveLength(1)
        expect(harness.captured[0]?.[1]?.content).toEqual([
          {
            type: "reasoning",
            text: "Encrypted thought",
            providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
          },
        ])
        expect(text?.text).toBe("Partial answer")
      }),
    { config: cfg },
  ),
)
