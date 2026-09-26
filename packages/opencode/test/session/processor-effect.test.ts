import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { APICallError, tool } from "ai"
import { Cause, Clock, Deferred, Duration, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import path from "path"
import z from "zod"
import type { Agent } from "../../src/agent/agent"
import { Provider } from "@/provider/provider"
import { Plugin } from "@/plugin"

import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { LLMAISDK } from "../../src/session/llm/ai-sdk"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionRetry } from "../../src/session/retry"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { raw, reply, TestLLMServer } from "../lib/llm-server"
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

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const waitFor = <A>(check: Effect.Effect<A | undefined>, message: string) =>
  Effect.gen(function* () {
    const stop = Date.now() + 500
    while (Date.now() < stop) {
      const value = yield* check
      if (value !== undefined) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(message))
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
  root: string,
) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
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
const env = LayerNode.compile(
  LayerNode.group([root, LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })]),
  replacements,
)

const it = testEffect(env)

const providerErrorLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: () =>
      Stream.make(
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call-1", name: "lookup" }),
        LLMEvent.toolInputEnd({ id: "call-1", name: "lookup" }),
        LLMEvent.toolCall({ id: "call-1", name: "lookup", input: {}, providerExecuted: true }),
        LLMEvent.toolResult({
          id: "call-1",
          name: "lookup",
          result: { type: "error", value: "provider boom" },
          providerExecuted: true,
        }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ),
  }),
)
const providerErrorEnv = LayerNode.compile(root, [...replacements, [LLM.node, providerErrorLLM]])
const itProviderError = testEffect(providerErrorEnv)

const fragmentFailureLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: () =>
      Stream.make(
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-1" }),
        LLMEvent.reasoningDelta({ id: "reasoning-1", text: "thinking" }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textDelta({ id: "text-1", text: "partial" }),
        LLMEvent.providerError({ message: "provider boom" }),
      ),
  }),
)
const fragmentFailureEnv = LayerNode.compile(root, [...replacements, [LLM.node, fragmentFailureLLM]])
const itFragmentFailure = testEffect(fragmentFailureEnv)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

it.live("session.processor effect tests capture llm input cleanly", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const { processors, session, provider } = yield* boot()

        yield* llm.text("hello")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const input = {
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "hi" }],
          tools: {},
        } satisfies LLM.StreamInput

        const value = yield* handle.process(input)
        const parts = yield* MessageV2.parts(msg.id)
        const calls = yield* llm.calls

        expect(value).toBe("continue")
        expect(calls).toBe(1)
        expect(parts.some((part) => part.type === "text" && part.text === "hello")).toBe(true)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests preserve text start time", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const gate = defer<void>()
        const { processors, session, provider } = yield* boot()

        yield* llm.push(
          raw({
            head: [
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: { role: "assistant" } }],
              },
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: { content: "hello" } }],
              },
            ],
            wait: gate.promise,
            tail: [
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: {}, finish_reason: "stop" }],
              },
            ],
          }),
        )

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies SessionV1.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "hi" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* waitFor(
          MessageV2.parts(msg.id).pipe(
            Effect.map((parts) => parts.find((part): part is SessionV1.TextPart => part.type === "text")),
            Effect.provideService(Database.Service, database),
          ),
          "timed out waiting for text part",
        )
        yield* Effect.sleep("20 millis")
        gate.resolve()

        const exit = yield* Fiber.await(run)
        const text = (yield* MessageV2.parts(msg.id)).find((part): part is SessionV1.TextPart => part.type === "text")

        expect(Exit.isSuccess(exit)).toBe(true)
        expect(text?.text).toBe("hello")
        expect(text?.time?.start).toBeDefined()
        expect(text?.time?.end).toBeDefined()
        if (!text?.time?.start || !text.time.end) return
        expect(text.time.start).toBeLessThan(text.time.end)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests stop after token overflow requests compaction", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const { processors, session, provider } = yield* boot()

        yield* llm.text("after", { usage: { input: 100, output: 0 } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const base = yield* provider.getModel(ref.providerID, ref.modelID)
        const mdl = { ...base, limit: { context: 20, output: 10 } }
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "compact" }],
          tools: {},
        })

        const parts = yield* MessageV2.parts(msg.id)

        expect(value).toBe("compact")
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(parts.some((part) => part.type === "step-finish")).toBe(true)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests capture reasoning from http mock", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const { processors, session, provider } = yield* boot()

        yield* llm.push(reply().reason("think").text("done").stop())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "reason")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "reason" }],
          tools: {},
        })

        const parts = yield* MessageV2.parts(msg.id)
        const reasoning = parts.find((part): part is SessionV1.ReasoningPart => part.type === "reasoning")
        const text = parts.find((part): part is SessionV1.TextPart => part.type === "text")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(1)
        expect(reasoning?.text).toBe("think")
        expect(text?.text).toBe("done")
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests reset reasoning state across retries", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.push(reply().reason("one").reset(), reply().reason("two").stop())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "reason")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "reason" }],
          tools: {},
        })

        const parts = yield* MessageV2.parts(msg.id)
        const reasoning = parts.filter((part): part is SessionV1.ReasoningPart => part.type === "reasoning")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(reasoning.some((part) => part.text === "two")).toBe(true)
        expect(reasoning.some((part) => part.text === "onetwo")).toBe(false)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests do not retry unknown json errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(400, { error: { message: "no_kv_space" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "json" }],
          tools: {},
        })

        expect(value).toBe("stop")
        expect(yield* llm.calls).toBe(1)
        expect(handle.message.error?.name).toBe("APIError")
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests retry recognized structured json errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(429, { type: "error", error: { type: "too_many_requests" } })
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry json" }],
          tools: {},
        })

        const parts = yield* MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests retry OpenAI-compatible midstream server errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.push(raw({ chunks: [{ error: { type: "server_error", code: "server_error", message: "xxx" } }] }))
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry midstream server error")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry midstream server error" }],
          tools: {},
        })

        const parts = yield* MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests retry network_error finish reasons", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.push(
          raw({
            chunks: [
              {
                id: "chatcmpl-network-error",
                object: "chat.completion.chunk",
                choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "network_error" }],
              },
            ],
          }),
        )
        yield* llm.text("after retry")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry network error")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry network error" }],
          tools: {},
        })

        const parts = yield* MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(parts.some((part) => part.type === "text" && part.text === "after retry")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests publish retry status updates", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const events = yield* EventV2Bridge.Service

        yield* llm.error(503, { error: "boom" })
        yield* llm.text("")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const states: number[] = []
        const off = yield* events.listen((evt) => {
          if (evt.type !== SessionStatus.Event.Status.type) return Effect.void
          const data = evt.data as typeof SessionStatus.Event.Status.data.Type
          if (data.sessionID === chat.id && data.status.type === "retry") states.push(data.status.attempt)
          return Effect.void
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry" }],
          tools: {},
        })

        yield* off

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(states).toStrictEqual([1])
      }),
    { config: (url) => providerCfg(url) },
  ),
)

for (const scenario of ["backoff cancellation", "hanging cancellation", "retry success"] as const) {
  it.effect(
    `session.processor G1 ${scenario}`,
    () =>
      provideTmpdirServer(
        ({ dir, llm }) =>
          Effect.gen(function* () {
            const { processors, session, provider } = yield* boot()
            const events = yield* EventV2Bridge.Service
            const status = yield* SessionStatus.Service
            const clock = yield* TestClock.testClockWith(Effect.succeed)
            const sleeping = yield* Deferred.make<number>()
            const retries: Extract<SessionStatus.Info, { type: "retry" }>[] = []
            const errors: string[] = []

            if (scenario === "hanging cancellation") yield* llm.hang
            if (scenario !== "hanging cancellation") {
              yield* llm.error(503, { error: "boom" })
              yield* llm.text("after")
            }

            const chat = yield* session.create({})
            const parent = yield* user(chat.id, "retry")
            const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
            const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
            const off = yield* events.listen((event) => {
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status)
              }
              if (event.type === Session.Event.Error.type) {
                const data = event.data as typeof Session.Event.Error.data.Type
                if (data.sessionID === chat.id && data.error) errors.push(data.error.name)
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({
              assistantMessage: msg,
              sessionID: chat.id,
              model: mdl,
            })
            const observedClock = {
              ...clock,
              sleep: (duration: Duration.Duration) =>
                Effect.gen(function* () {
                  if (retries.length !== 1) return yield* clock.sleep(duration)
                  // Observe the registered timer, not the earlier retry-status publication.
                  const timer = yield* clock.sleep(duration).pipe(Effect.forkChild({ startImmediately: true }))
                  yield* Deferred.succeed(sleeping, Duration.toMillis(duration))
                  yield* Fiber.join(timer)
                }),
            } satisfies Clock.Clock
            const run = yield* handle
              .process({
                user: {
                  id: parent.id,
                  sessionID: chat.id,
                  role: "user",
                  time: parent.time,
                  agent: parent.agent,
                  model: ref,
                },
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [{ role: "user", content: "retry" }],
                tools: {},
              })
              .pipe(Effect.provideService(Clock.Clock, observedClock), Effect.forkChild)

            if (scenario === "hanging cancellation") {
              const reached = yield* clock.withLive(
                awaitWithTimeout(
                  Effect.raceFirst(
                    llm.wait(1).pipe(Effect.as("request")),
                    Fiber.await(run).pipe(Effect.as("completed")),
                  ),
                  "processor completed or never opened the hanging request",
                  "5 seconds",
                ),
              )
              expect(reached).toBe("request")
              expect(retries).toEqual([])
            }
            if (scenario !== "hanging cancellation") {
              const reached = yield* clock.withLive(
                awaitWithTimeout(
                  Effect.raceFirst(
                    Deferred.await(sleeping).pipe(Effect.map((ms) => ({ type: "sleep" as const, ms }))),
                    Fiber.await(run).pipe(Effect.map((exit) => ({ type: "completed" as const, exit }))),
                  ),
                  "processor never entered first retry sleep",
                  "5 seconds",
                ),
              )
              expect(reached.type).toBe("sleep")
              if (reached.type !== "sleep") throw new Error("processor completed before backoff")
              expect(retries.map((item) => item.attempt)).toEqual([1])
              expect(reached.ms).toBeGreaterThanOrEqual(SessionRetry.delay(1, undefined, 0))
              expect(reached.ms).toBeLessThanOrEqual(SessionRetry.delay(1, undefined, 1))
              expect(retries[0].next).toBe(clock.currentTimeMillisUnsafe() + reached.ms)
              expect(yield* llm.calls).toBe(1)
            }

            if (scenario === "retry success") yield* clock.adjust(SessionRetry.delay(1, undefined, 1))
            if (scenario !== "retry success") {
              yield* clock.withLive(
                awaitWithTimeout(Fiber.interrupt(run), "processor cancellation did not finish", "5 seconds"),
              )
            }
            const exit = yield* clock.withLive(
              awaitWithTimeout(Fiber.await(run), "processor did not finish", "5 seconds"),
            )
            const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
            expect(stored.info.role).toBe("assistant")
            if (stored.info.role !== "assistant") throw new Error("expected stored assistant")
            expect(handle.message.time.completed).toEqual(expect.any(Number))
            expect(stored.info.time.completed).toBe(handle.message.time.completed)
            const observed = {
              requests: yield* llm.calls,
              interrupted: Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
              result: Exit.isSuccess(exit) ? exit.value : null,
              handleError: handle.message.error?.name ?? null,
              storedError: stored.info.error?.name ?? null,
              errors,
            }
            console.log(
              "G1 observation",
              JSON.stringify({
                scenario,
                ...observed,
                completed: stored.info.time.completed,
                status: (yield* status.get(chat.id)).type,
              }),
            )
            expect(observed).toEqual({
              requests: scenario === "retry success" ? 2 : 1,
              interrupted: scenario !== "retry success",
              result: scenario === "retry success" ? "continue" : null,
              handleError: scenario === "retry success" ? null : "MessageAbortedError",
              storedError: scenario === "retry success" ? null : "MessageAbortedError",
              errors: scenario === "retry success" ? [] : ["MessageAbortedError"],
            })
            if (scenario === "retry success") {
              expect(stored.parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
              expect(retries.map((item) => item.attempt)).toEqual([1])
            }
            if (scenario !== "retry success") expect(yield* status.get(chat.id)).toMatchObject({ type: "idle" })
          }),
        { config: (url) => providerCfg(url) },
      ),
    30_000,
  )
}

const g2Text = () => [
  LLMEvent.textStart({ id: "g2-text" }),
  LLMEvent.textDelta({ id: "g2-text", text: "usable" }),
  LLMEvent.textEnd({ id: "g2-text" }),
]
const g2Start = () => LLMEvent.stepStart({ index: 0 })
const g2Step = (reason: "stop" | "unknown") => LLMEvent.stepFinish({ index: 0, reason })
const g2Finish = (reason: "stop" | "unknown") => LLMEvent.finish({ reason })
const g2Cases: { name: string; events: LLMEvent[]; accepted: boolean; failure?: "error" | "type-error" }[] = [
  { name: "empty normalized stream", events: [], accepted: false },
  { name: "active step EOF", events: [g2Start()], accepted: false },
  { name: "final finish only", events: [g2Finish("stop")], accepted: false },
  { name: "active step with final finish", events: [g2Start(), g2Finish("stop")], accepted: false },
  {
    name: "later unsettled step",
    events: [g2Start(), g2Step("stop"), LLMEvent.stepStart({ index: 1 })],
    accepted: false,
  },
  { name: "text without settled step", events: [g2Start(), ...g2Text()], accepted: false },
  { name: "empty unknown", events: [g2Start(), g2Step("unknown"), g2Finish("unknown")], accepted: false },
  {
    name: "reasoning-only unknown",
    events: [
      g2Start(),
      LLMEvent.reasoningStart({ id: "g2-reasoning" }),
      LLMEvent.reasoningDelta({ id: "g2-reasoning", text: "thinking" }),
      LLMEvent.reasoningEnd({ id: "g2-reasoning" }),
      g2Step("unknown"),
      g2Finish("unknown"),
    ],
    accepted: false,
  },
  {
    name: "whitespace-only unknown",
    events: [
      g2Start(),
      LLMEvent.textStart({ id: "g2-text" }),
      LLMEvent.textDelta({ id: "g2-text", text: "   " }),
      LLMEvent.textEnd({ id: "g2-text" }),
      g2Step("unknown"),
      g2Finish("unknown"),
    ],
    accepted: false,
  },
  { name: "valid empty stop", events: [g2Start(), g2Step("stop"), g2Finish("stop")], accepted: true },
  { name: "usable unknown", events: [g2Start(), ...g2Text(), g2Step("unknown"), g2Finish("unknown")], accepted: true },
  { name: "ordinary error after text", events: [g2Start(), ...g2Text()], accepted: false, failure: "error" },
  { name: "ordinary TypeError", events: [], accepted: false, failure: "type-error" },
]

for (const fixture of g2Cases) {
  const calls: number[] = []
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        calls.push(1)
        // A detector may retry once; the fallback is deliberately nonretryable, not a budget test.
        if (calls.length > 1) return Stream.fail(new Error("G2 nonretryable fallback"))
        const events = Stream.fromIterable(fixture.events)
        if (!fixture.failure) return events
        return Stream.concat(
          events,
          Stream.fail(
            fixture.failure === "type-error" ? new TypeError("G2 ordinary failure") : new Error("G2 ordinary failure"),
          ),
        )
      },
    }),
  )
  const g2 = testEffect(LayerNode.compile(root, [...replacements, [LLM.node, source]]))
  g2.effect(
    `session.processor G2 ${fixture.name}`,
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            calls.length = 0
            const { processors, session, provider } = yield* boot()
            const events = yield* EventV2Bridge.Service
            const clock = yield* TestClock.testClockWith(Effect.succeed)
            const sleeping = yield* Deferred.make<number>()
            const retries: number[] = []
            const errors: string[] = []
            const chat = yield* session.create({})
            const parent = yield* user(chat.id, "settle")
            const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
            const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
            const off = yield* events.listen((event) => {
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status.attempt)
              }
              if (event.type === Session.Event.Error.type) {
                const data = event.data as typeof Session.Event.Error.data.Type
                if (data.sessionID === chat.id && data.error) errors.push(data.error.name)
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const observedClock = {
              ...clock,
              sleep: (duration: Duration.Duration) =>
                Effect.gen(function* () {
                  if (retries.length !== 1) return yield* clock.sleep(duration)
                  const timer = yield* clock.sleep(duration).pipe(Effect.forkChild({ startImmediately: true }))
                  yield* Deferred.succeed(sleeping, Duration.toMillis(duration))
                  yield* Fiber.join(timer)
                }),
            } satisfies Clock.Clock
            const run = yield* handle
              .process({
                user: {
                  id: parent.id,
                  sessionID: chat.id,
                  role: "user",
                  time: parent.time,
                  agent: parent.agent,
                  model: ref,
                },
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [{ role: "user", content: "settle" }],
                tools: {},
              })
              .pipe(Effect.provideService(Clock.Clock, observedClock), Effect.forkChild)
            const first = yield* clock.withLive(
              awaitWithTimeout(
                Effect.raceFirst(
                  Fiber.await(run).pipe(Effect.map((exit) => ({ type: "completed" as const, exit }))),
                  Deferred.await(sleeping).pipe(Effect.map((ms) => ({ type: "sleep" as const, ms }))),
                ),
                "G2 processor neither completed nor entered retry sleep",
                "5 seconds",
              ),
            )
            if (first.type === "sleep") {
              expect(fixture.accepted || !!fixture.failure).toBe(false)
              expect(retries).toEqual([1])
              expect(first.ms).toBeLessThanOrEqual(SessionRetry.delay(1, undefined, 1))
              yield* clock.adjust(SessionRetry.delay(1, undefined, 1))
            }
            const exit = yield* clock.withLive(
              awaitWithTimeout(Fiber.await(run), "G2 processor did not finish", "5 seconds"),
            )
            expect(Exit.isSuccess(exit)).toBe(true)
            if (!Exit.isSuccess(exit)) throw new Error("unexpected processor failure Exit")
            const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
            expect(stored.info.role).toBe("assistant")
            if (stored.info.role !== "assistant") throw new Error("expected stored assistant")
            expect(handle.message.time.completed).toEqual(expect.any(Number))
            expect(stored.info.time.completed).toBe(handle.message.time.completed)
            const observed = {
              result: exit.value,
              handleError: handle.message.error?.name ?? null,
              storedError: stored.info.error?.name ?? null,
            }
            console.log(
              "G2 processor observation",
              JSON.stringify({
                name: fixture.name,
                invocations: calls.length,
                retries,
                ...observed,
                steps: stored.parts.filter((part) => part.type === "step-finish").map((part) => part.reason),
                texts: stored.parts.filter((part) => part.type === "text").map((part) => part.text),
                errors,
              }),
            )
            expect(observed).toEqual({
              result: fixture.accepted ? "continue" : "stop",
              handleError: fixture.accepted ? null : "UnknownError",
              storedError: fixture.accepted ? null : "UnknownError",
            })
            expect(calls.length).toBeLessThanOrEqual(2)
            if (fixture.accepted || fixture.failure) {
              expect(calls).toHaveLength(1)
              expect(retries).toEqual([])
            }
            expect(errors).toEqual(fixture.accepted ? [] : ["UnknownError"])
            if (fixture.failure)
              expect(stored.info.error).toMatchObject({
                name: "UnknownError",
                data: { message: "G2 ordinary failure" },
              })
            if (fixture.name === "usable unknown" || fixture.name === "ordinary error after text")
              expect(stored.parts.some((part) => part.type === "text" && part.text === "usable")).toBe(true)
          }),
        { config: cfg },
      ),
    30_000,
  )
}

const g3Tool = { id: "g3-call", name: "lookup" }
const g3Call = () => LLMEvent.toolCall({ ...g3Tool, input: {} })
const g3Result = () => LLMEvent.toolResult({ ...g3Tool, result: { type: "text", value: "kept-result" } })
const g3Cases: {
  name: string
  events: LLMEvent[]
  retry?: boolean
  hook?: "success" | "throw" | "uninvoked" | "no-match"
  cause?: "failure-first" | "interrupt-first" | "interrupt-only"
  completedTool?: boolean
  driverFailure?: "driver" | "drain"
}[] = [
  { name: "ordinary failure before activity", events: [], retry: true },
  { name: "tool input start", events: [LLMEvent.toolInputStart(g3Tool)] },
  { name: "tool input delta without start", events: [LLMEvent.toolInputDelta({ ...g3Tool, text: "{" })] },
  { name: "tool input end without start", events: [LLMEvent.toolInputEnd(g3Tool)] },
  { name: "tool call", events: [g3Call()] },
  { name: "orphan tool result", events: [g3Result()] },
  { name: "orphan tool error", events: [LLMEvent.toolError({ ...g3Tool, message: "tool failed" })] },
  { name: "completed tool result", events: [g3Call(), g3Result()], completedTool: true },
  { name: "matching hook success then failure", events: g2Text(), hook: "success" },
  { name: "matching hook throws", events: g2Text(), hook: "throw" },
  { name: "registered hook not invoked", events: [], hook: "uninvoked", retry: true },
  { name: "no matching hook", events: g2Text(), hook: "no-match", retry: true },
  { name: "mixed failure first", events: [], cause: "failure-first" },
  { name: "mixed interrupt first", events: [], cause: "interrupt-first" },
  { name: "pure interrupt", events: [], cause: "interrupt-only" },
  { name: "driver failure drains pending tool", events: [g3Call()], driverFailure: "driver" },
  { name: "driver and drain failures remain observable", events: [g3Call()], driverFailure: "drain" },
]

for (const fixture of g3Cases) {
  let calls = 0
  let failures = 0
  let injected: APICallError | undefined
  const failure = () =>
    new APICallError({
      message: "G3 retryable failure",
      url: "http://localhost/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    })
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        calls++
        // Empty successful fallback cannot accidentally invoke a registered text hook.
        if (calls === 2) return Stream.make(g2Start(), g2Step("stop"), g2Finish("stop"))
        if (calls > 2) return Stream.fail(new Error("G3 unexpected third invocation"))
        return Stream.concat(
          Stream.fromIterable([g2Start(), ...fixture.events]),
          Stream.failCauseSync(() => {
            failures++
            injected = failure()
            const failed = Cause.fail(injected)
            const interrupted = Cause.interrupt()
            if (!fixture.cause) return failed
            const cause =
              fixture.cause === "interrupt-only"
                ? interrupted
                : fixture.cause === "failure-first"
                  ? Cause.combine(failed, interrupted)
                  : Cause.combine(interrupted, failed)
            expect(Cause.hasInterrupts(cause)).toBe(true)
            expect(Cause.hasInterruptsOnly(cause)).toBe(fixture.cause === "interrupt-only")
            return cause
          }),
        )
      },
    }),
  )
  const g3 = testEffect(
    LayerNode.compile(LayerNode.group([root, Plugin.node]), [
      [SessionSummary.node, summary],
      [
        RuntimeFlags.node,
        RuntimeFlags.layer({ experimentalEventSystem: true, disableDefaultPlugins: true, pure: true }),
      ],
      [LLM.node, source],
    ]),
  )
  g3.effect(
    `session.processor G3 ${fixture.name}`,
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            calls = 0
            failures = 0
            injected = undefined
            const { processors, session, provider } = yield* boot()
            const plugin = yield* Plugin.Service
            // list() exposes this instance's dispatch list; keep real trigger(), not the loader path.
            const hooks = yield* plugin.list()
            expect(hooks).toHaveLength(0)
            const invoked: { sessionID: string; messageID: string; partID: string }[] = []
            const hook: (typeof hooks)[number] =
              fixture.hook && fixture.hook !== "no-match"
                ? {
                    "experimental.text.complete": async (input, output) => {
                      invoked.push(input)
                      if (fixture.hook === "throw") throw failure()
                      output.text = "hook-transformed"
                    },
                  }
                : {}
            if (fixture.hook) {
              hooks.push(hook)
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  const index = hooks.indexOf(hook)
                  if (index >= 0) hooks.splice(index, 1)
                }),
              )
            }
            const bridge = yield* EventV2Bridge.Service
            const clock = yield* TestClock.testClockWith(Effect.succeed)
            const timers = yield* Queue.unbounded<{ ms: number; phase: string; attempt: number }>()
            const pendingTimers = new Set<{ deadline: number }>()
            let draining = false
            const driverFailure = new Error("G3 injected driver failure")
            const drainFailure = new Error("G3 injected drain failure")
            let phase = "initial"
            let attempt = 0
            const retries: number[] = []
            const errors: string[] = []
            const sleeps: { ms: number; phase: string; attempt: number }[] = []
            const chat = yield* session.create({})
            const parent = yield* user(chat.id, "activity")
            const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
            const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
            const off = yield* bridge.listen((event) => {
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id) {
                  phase = data.status.type
                  if (data.status.type === "retry") {
                    attempt = data.status.attempt
                    retries.push(attempt)
                  }
                }
              }
              if (event.type === Session.Event.Error.type) {
                const data = event.data as typeof Session.Event.Error.data.Type
                if (data.sessionID === chat.id && data.error) errors.push(data.error.name)
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const observedClock = {
              ...clock,
              sleep: (duration: Duration.Duration) =>
                Effect.gen(function* () {
                  if (draining) return yield* clock.withLive(Effect.sleep(duration))
                  const observation = { ms: Duration.toMillis(duration), phase, attempt }
                  const pending = { deadline: clock.currentTimeMillisUnsafe() + observation.ms }
                  const timer = yield* clock.sleep(duration).pipe(Effect.forkChild({ startImmediately: true }))
                  pendingTimers.add(pending)
                  yield* Effect.gen(function* () {
                    yield* Queue.offer(timers, observation)
                    yield* Fiber.join(timer)
                  }).pipe(Effect.ensuring(Effect.sync(() => pendingTimers.delete(pending))))
                }),
            } satisfies Clock.Clock
            const run = yield* handle
              .process({
                user: {
                  id: parent.id,
                  sessionID: chat.id,
                  role: "user",
                  time: parent.time,
                  agent: parent.agent,
                  model: ref,
                },
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [{ role: "user", content: "activity" }],
                tools: {},
              })
              .pipe(Effect.provideService(Clock.Clock, observedClock), Effect.forkChild)
            // Pending-tool cleanup also sleeps. Observe each real timer, not just retry status.
            const driven = yield* Effect.gen(function* () {
              for (let n = 0; n < 6; n++) {
                const next = yield* clock.withLive(
                  awaitWithTimeout(
                    Effect.raceFirst(
                      Fiber.await(run).pipe(Effect.map((exit) => ({ type: "completed" as const, exit }))),
                      Queue.take(timers).pipe(Effect.map((timer) => ({ type: "timer" as const, timer }))),
                    ),
                    "G3 processor neither completed nor registered a timer",
                    "5 seconds",
                  ),
                )
                if (next.type === "completed") return next.exit
                sleeps.push(next.timer)
                if (fixture.driverFailure) return yield* Effect.fail(driverFailure)
                if (next.timer.phase === "retry") {
                  yield* clock.adjust(SessionRetry.delay(next.timer.attempt, undefined, 1))
                } else {
                  yield* clock.adjust(next.timer.ms)
                }
              }
              throw new Error("G3 processor exceeded finite timer budget")
            }).pipe(
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : clock.withLive(
                      awaitWithTimeout(
                        Effect.gen(function* () {
                          // This only runs after driver failure, never during a behavioral observation.
                          draining = true
                          run.interruptUnsafe()
                          const now = clock.currentTimeMillisUnsafe()
                          const deadline = Math.max(now, ...Array.from(pendingTimers, (timer) => timer.deadline))
                          yield* clock.adjust(deadline - now)
                          yield* Fiber.await(run)
                          if (fixture.driverFailure === "drain") return yield* Effect.fail(drainFailure)
                        }),
                        "G3 failed-driver cleanup did not finish",
                        "5 seconds",
                      ).pipe(
                        Effect.exit,
                        Effect.flatMap((drain) =>
                          Exit.isFailure(drain)
                            ? Effect.failCause(Cause.combine(exit.cause, drain.cause))
                            : Effect.void,
                        ),
                      ),
                    ),
              ),
              Effect.exit,
            )
            // Validate timers only after processor exit so assertion failures cannot freeze cleanup.
            for (const timer of sleeps) {
              if (timer.phase !== "retry") continue
              expect(timer.attempt).toBeGreaterThan(0)
              expect(timer.ms).toBeGreaterThanOrEqual(SessionRetry.delay(timer.attempt, undefined, 0))
              expect(timer.ms).toBeLessThanOrEqual(SessionRetry.delay(timer.attempt, undefined, 1))
            }
            if (fixture.driverFailure) {
              expect(Exit.isFailure(driven)).toBe(true)
              if (!Exit.isFailure(driven)) throw new Error("expected driver failure")
              expect(driven.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error)).toEqual(
                fixture.driverFailure === "drain" ? [driverFailure, drainFailure] : [driverFailure],
              )
              const ended = yield* Fiber.await(run)
              expect(Exit.isFailure(ended) && Cause.hasInterrupts(ended.cause)).toBe(true)
              expect(calls).toBe(1)
              const saved = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
              expect(saved.parts.find((part) => part.type === "tool" && part.callID === g3Tool.id)).toMatchObject({
                state: { status: "error" },
              })
              console.log(
                "G3 driver cleanup observation",
                JSON.stringify({ calls, retries, completed: handle.message.time.completed != null }),
              )
              return
            }
            const exit = yield* driven
            const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
            expect(stored.info.role).toBe("assistant")
            if (stored.info.role !== "assistant") throw new Error("expected stored assistant")
            expect(handle.message.time.completed).toEqual(expect.any(Number))
            expect(stored.info.time.completed).toBe(handle.message.time.completed)
            const invokedExpected = fixture.hook === "success" || fixture.hook === "throw" ? 1 : 0
            expect(invoked).toHaveLength(invokedExpected)
            for (const input of invoked) {
              expect(input.sessionID).toBe(chat.id)
              expect(input.messageID).toBe(msg.id)
              expect(stored.parts.some((part) => part.id === input.partID && part.type === "text")).toBe(true)
            }
            expect(failures).toBe(fixture.hook === "throw" ? 0 : 1)
            if (fixture.hook === "success")
              expect(stored.parts.some((part) => part.type === "text" && part.text === "hook-transformed")).toBe(true)
            if (fixture.completedTool)
              expect(stored.parts.find((part) => part.type === "tool" && part.callID === g3Tool.id)).toMatchObject({
                state: { status: "completed", output: "kept-result" },
              })
            const observed = {
              calls,
              retries,
              result: Exit.isSuccess(exit) ? exit.value : null,
              interrupted: Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause),
              retainedFailure:
                Exit.isFailure(exit) &&
                exit.cause.reasons.some((reason) => Cause.isFailReason(reason) && reason.error === injected),
              handleError: handle.message.error?.name ?? null,
              storedError: stored.info.error?.name ?? null,
            }
            console.log(
              "G3 processor observation",
              JSON.stringify({ name: fixture.name, ...observed, invoked: invoked.length, failures, errors, sleeps }),
            )
            expect(observed).toEqual({
              calls: fixture.retry ? 2 : 1,
              retries: fixture.retry ? [1] : [],
              result: fixture.cause ? null : fixture.retry ? "continue" : "stop",
              interrupted: !!fixture.cause,
              retainedFailure: fixture.cause === "failure-first" || fixture.cause === "interrupt-first",
              handleError: fixture.cause ? "MessageAbortedError" : fixture.retry ? null : "APIError",
              storedError: fixture.cause ? "MessageAbortedError" : fixture.retry ? null : "APIError",
            })
            expect(errors).toEqual(fixture.cause ? ["MessageAbortedError"] : fixture.retry ? [] : ["APIError"])
          }),
        { config: cfg },
      ),
    30_000,
  )
}

type G4Kind = "ordinary" | "fatal" | "eof" | "adapter" | "stop"
const g4Text = (attempt: number) => [
  LLMEvent.textStart({ id: `g4-text-${attempt}` }),
  LLMEvent.textDelta({ id: `g4-text-${attempt}`, text: `g4 attempt ${attempt}` }),
  LLMEvent.textEnd({ id: `g4-text-${attempt}` }),
]
const g4Cases: {
  name: string
  sequence: G4Kind[]
  calls: number
  result: "stop" | "continue"
  error: "APIError" | "UnknownError" | null
  activity?: LLMEvent[]
  hook?: "invoked" | "uninvoked" | "no-match"
  completedTool?: boolean
}[] = [
  {
    name: "ordinary cap",
    sequence: ["ordinary", "ordinary", "ordinary", "ordinary", "ordinary", "ordinary", "stop"],
    calls: 6,
    result: "stop",
    error: "APIError",
  },
  {
    name: "ordinary last allowed recovery",
    sequence: ["ordinary", "ordinary", "ordinary", "ordinary", "ordinary", "stop"],
    calls: 6,
    result: "continue",
    error: null,
  },
  { name: "nonretryable immediate", sequence: ["fatal", "stop"], calls: 1, result: "stop", error: "UnknownError" },
  {
    name: "nonretryable after ordinary",
    sequence: ["ordinary", "fatal", "stop"],
    calls: 2,
    result: "stop",
    error: "UnknownError",
  },
  {
    name: "EOF allowance exhaustion",
    sequence: ["eof", "eof", "eof", "stop"],
    calls: 3,
    result: "stop",
    error: "UnknownError",
  },
  {
    name: "canonical adapter allowance exhaustion",
    sequence: ["adapter", "adapter", "adapter", "stop"],
    calls: 3,
    result: "stop",
    error: "UnknownError",
  },
  {
    name: "EOF and canonical adapter share allowance",
    sequence: ["eof", "adapter", "eof", "stop"],
    calls: 3,
    result: "stop",
    error: "UnknownError",
  },
  {
    name: "canonical adapter and EOF share allowance",
    sequence: ["adapter", "eof", "adapter", "stop"],
    calls: 3,
    result: "stop",
    error: "UnknownError",
  },
  { name: "last incomplete recovery", sequence: ["eof", "adapter", "stop"], calls: 3, result: "continue", error: null },
  {
    name: "ordinary does not consume incomplete allowance",
    sequence: ["ordinary", "eof", "ordinary", "adapter", "stop"],
    calls: 5,
    result: "continue",
    error: null,
  },
  {
    name: "global cap wins before incomplete allowance",
    sequence: ["ordinary", "ordinary", "ordinary", "eof", "ordinary", "adapter", "stop"],
    calls: 6,
    result: "stop",
    error: "UnknownError",
  },
  {
    name: "incomplete allowance wins before global cap",
    sequence: ["eof", "ordinary", "adapter", "ordinary", "eof", "stop"],
    calls: 5,
    result: "stop",
    error: "UnknownError",
  },
]
for (const kind of ["eof", "adapter"] as const) {
  for (const activity of [
    { name: "tool input start", events: [LLMEvent.toolInputStart(g3Tool)] },
    { name: "tool input delta without start", events: [LLMEvent.toolInputDelta({ ...g3Tool, text: "{" })] },
    { name: "tool input end without start", events: [LLMEvent.toolInputEnd(g3Tool)] },
    { name: "tool call", events: [g3Call()] },
    { name: "orphan tool result", events: [g3Result()] },
    { name: "orphan tool error", events: [LLMEvent.toolError({ ...g3Tool, message: "tool failed" })] },
    { name: "completed tool", events: [g3Call(), g3Result()], completed: true },
  ]) {
    g4Cases.push({
      name: `${kind} after ${activity.name}`,
      sequence: [kind, "stop"],
      calls: 1,
      result: "stop",
      error: "UnknownError",
      activity: activity.events,
      completedTool: activity.completed,
    })
  }
  for (const hook of ["invoked", "uninvoked", "no-match"] as const) {
    g4Cases.push({
      name: `${kind} hook ${hook}`,
      sequence: [kind, "stop"],
      calls: hook === "invoked" ? 1 : 2,
      result: hook === "invoked" ? "stop" : "continue",
      error: hook === "invoked" ? "UnknownError" : null,
      activity: hook === "uninvoked" ? [] : g4Text(1),
      hook,
    })
  }
}

const g4Run = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  state: () => { phase: string; attempt: number; calls: number },
) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.testClockWith(Effect.succeed)
    type Timer = ReturnType<typeof state> & { ms: number; deadline: number }
    const timers = yield* Queue.unbounded<Timer>()
    const pending = new Set<Timer>()
    const sleeps: Timer[] = []
    let draining = false
    const observedClock = {
      ...clock,
      sleep: (duration: Duration.Duration) =>
        Effect.gen(function* () {
          if (draining) return yield* clock.withLive(Effect.sleep(duration))
          const observation = {
            ...state(),
            ms: Duration.toMillis(duration),
            deadline: clock.currentTimeMillisUnsafe() + Duration.toMillis(duration),
          }
          const timer = yield* clock.sleep(duration).pipe(Effect.forkChild({ startImmediately: true }))
          pending.add(observation)
          yield* Effect.gen(function* () {
            yield* Queue.offer(timers, observation)
            yield* Fiber.join(timer)
          }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(observation))))
        }),
    } satisfies Clock.Clock
    const run = yield* effect.pipe(Effect.provideService(Clock.Clock, observedClock), Effect.forkChild)
    const exit = yield* Effect.gen(function* () {
      for (let n = 0; n < 16; n++) {
        const next = yield* clock.withLive(
          awaitWithTimeout(
            Effect.raceFirst(
              Fiber.await(run).pipe(Effect.map((exit) => ({ type: "completed" as const, exit }))),
              Queue.take(timers).pipe(Effect.map((timer) => ({ type: "timer" as const, timer }))),
            ),
            "G4 processor neither completed nor registered a timer",
            "5 seconds",
          ),
        )
        if (next.type === "completed") return next.exit
        sleeps.push(next.timer)
        yield* clock.adjust(
          next.timer.phase === "retry" ? SessionRetry.delay(next.timer.attempt, undefined, 1) : next.timer.ms,
        )
      }
      throw new Error("G4 finite timer budget exceeded")
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : clock.withLive(
              awaitWithTimeout(
                Effect.gen(function* () {
                  draining = true
                  run.interruptUnsafe()
                  const now = clock.currentTimeMillisUnsafe()
                  yield* clock.adjust(Math.max(now, ...Array.from(pending, (timer) => timer.deadline)) - now)
                  yield* Fiber.await(run)
                }),
                "G4 failed-driver cleanup did not finish",
                "5 seconds",
              ).pipe(
                Effect.exit,
                Effect.flatMap((drain) =>
                  Exit.isFailure(drain) ? Effect.failCause(Cause.combine(exit.cause, drain.cause)) : Effect.void,
                ),
              ),
            ),
      ),
    )
    for (const timer of sleeps) {
      if (timer.phase !== "retry") continue
      expect(timer.calls).toBe(timer.attempt)
      expect(timer.ms).toBeGreaterThanOrEqual(SessionRetry.delay(timer.attempt, undefined, 0))
      expect(timer.ms).toBeLessThanOrEqual(SessionRetry.delay(timer.attempt, undefined, 1))
    }
    return { exit, sleeps }
  })

for (const fixture of g4Cases) {
  let invocations = 0
  const consumed: G4Kind[] = []
  const classifications: (string | undefined)[][] = []
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        const kind = fixture.sequence[invocations++]
        if (!kind) return Stream.fail(new Error("G4 unexpected extra invocation"))
        consumed.push(kind)
        const ordinal = consumed.length
        const activity =
          ordinal === 1 && fixture.activity !== undefined
            ? fixture.activity
            : fixture.activity === undefined && kind !== "stop"
              ? g4Text(ordinal)
              : []
        return Stream.fromEffect(
          Effect.gen(function* () {
            if (kind !== "adapter")
              return [g2Start(), ...activity, ...(kind === "stop" ? [g2Step("stop"), g2Finish("stop")] : [])]
            // Typed SDK boundary input through the real adapter; never inject an unsupported normalized classification.
            // G2 separately verifies this other/raw-undefined shape is emitted by the pinned real SDK on wire EOF.
            const adapter = LLMAISDK.adapterState()
            const start = yield* LLMAISDK.toLLMEvents(adapter, { type: "start-step", request: {}, warnings: [] })
            const usage = {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
              inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
              outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
            }
            const step = yield* LLMAISDK.toLLMEvents(adapter, {
              type: "finish-step",
              response: { id: `g4-${ordinal}`, timestamp: new Date(0), modelId: "test-model" },
              finishReason: "other",
              rawFinishReason: undefined,
              providerMetadata: undefined,
              usage,
            })
            const finish = yield* LLMAISDK.toLLMEvents(adapter, {
              type: "finish",
              finishReason: "other",
              rawFinishReason: undefined,
              totalUsage: usage,
            })
            classifications.push(
              [...step, ...finish]
                .filter((event) => event.type === "provider-error")
                .map((event) => event.classification),
            )
            return [...start, ...activity, ...step, ...finish]
          }),
        ).pipe(
          Stream.flatMap((events) => {
            const stream = Stream.fromIterable(events)
            if (kind === "ordinary")
              return Stream.concat(
                stream,
                Stream.fail(
                  new APICallError({
                    message: "G4 ordinary failure",
                    url: "http://localhost/v1/chat/completions",
                    requestBodyValues: {},
                    statusCode: 503,
                    isRetryable: true,
                  }),
                ),
              )
            if (kind === "fatal") return Stream.concat(stream, Stream.fail(new Error("G4 nonretryable failure")))
            return stream
          }),
        )
      },
    }),
  )
  const g4 = testEffect(
    LayerNode.compile(LayerNode.group([root, Plugin.node]), [
      [SessionSummary.node, summary],
      [
        RuntimeFlags.node,
        RuntimeFlags.layer({ experimentalEventSystem: true, disableDefaultPlugins: true, pure: true }),
      ],
      [LLM.node, source],
    ]),
  )
  g4.effect(
    `session.processor G4 ${fixture.name}`,
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            invocations = 0
            consumed.length = 0
            classifications.length = 0
            const { processors, session, provider } = yield* boot()
            const plugin = yield* Plugin.Service
            const hooks = yield* plugin.list()
            expect(hooks).toHaveLength(0)
            const invoked: { sessionID: string; messageID: string; partID: string }[] = []
            const hook: (typeof hooks)[number] =
              fixture.hook && fixture.hook !== "no-match"
                ? {
                    "experimental.text.complete": async (input, output) => {
                      invoked.push(input)
                      output.text = "g4 hook text"
                    },
                  }
                : {}
            if (fixture.hook) {
              hooks.push(hook)
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  const index = hooks.indexOf(hook)
                  if (index >= 0) hooks.splice(index, 1)
                }),
              )
            }
            const chat = yield* session.create({})
            const parent = yield* user(chat.id, "budgets")
            const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
            // G4 must earn settlement from events, not the shared helper's seeded finish.
            delete msg.finish
            yield* session.updateMessage(msg)
            const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
            const bridge = yield* EventV2Bridge.Service
            let phase = "initial"
            let attempt = 0
            const retries: number[] = []
            const errors: string[] = []
            const off = yield* bridge.listen((event) => {
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id) {
                  phase = data.status.type
                  if (data.status.type === "retry") {
                    attempt = data.status.attempt
                    retries.push(attempt)
                  }
                }
              }
              if (event.type === Session.Event.Error.type) {
                const data = event.data as typeof Session.Event.Error.data.Type
                if (data.sessionID === chat.id && data.error) errors.push(data.error.name)
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const { exit, sleeps } = yield* g4Run(
              handle.process({
                user: {
                  id: parent.id,
                  sessionID: chat.id,
                  role: "user",
                  time: parent.time,
                  agent: parent.agent,
                  model: ref,
                },
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [{ role: "user", content: "budgets" }],
                tools: {},
              }),
              () => ({ phase, attempt, calls: invocations }),
            )
            expect(Exit.isSuccess(exit)).toBe(true)
            if (!Exit.isSuccess(exit)) throw new Error("unexpected G4 processor failure Exit")
            const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
            expect(stored.info.role).toBe("assistant")
            if (stored.info.role !== "assistant") throw new Error("expected stored assistant")
            expect(handle.message.time.completed).toEqual(expect.any(Number))
            expect(stored.info.time.completed).toBe(handle.message.time.completed)
            expect(invoked).toHaveLength(fixture.hook === "invoked" ? 1 : 0)
            for (const input of invoked) {
              expect(input.sessionID).toBe(chat.id)
              expect(input.messageID).toBe(msg.id)
              expect(
                stored.parts.some(
                  (part) => part.id === input.partID && part.type === "text" && part.text === "g4 hook text",
                ),
              ).toBe(true)
            }
            if (fixture.completedTool)
              expect(stored.parts.find((part) => part.type === "tool" && part.callID === g3Tool.id)).toMatchObject({
                state: { status: "completed", output: "kept-result" },
              })
            // Check only retained terminal output here, not deletion of earlier attempts or accounting rollback.
            if (fixture.activity === undefined && consumed.at(-1) !== "stop")
              expect(
                stored.parts.some((part) => part.type === "text" && part.text === `g4 attempt ${consumed.length}`),
              ).toBe(true)
            const steps = stored.parts.filter((part) => part.type === "step-finish").map((part) => part.reason)
            if (consumed.at(-1) === "stop") {
              expect(steps.at(-1)).toBe("stop")
              expect(stored.info.finish).toBe("stop")
              expect(handle.message.finish).toBe("stop")
            }
            if (consumed.at(-1) === "adapter") expect(steps.at(-1)).toBe("unknown")
            const observed = {
              invocations,
              consumed: [...consumed],
              retries,
              result: exit.value,
              handleError: handle.message.error?.name ?? null,
              storedError: stored.info.error?.name ?? null,
            }
            console.log(
              "G4 processor observation",
              JSON.stringify({
                name: fixture.name,
                planned: fixture.sequence,
                ...observed,
                classifications,
                steps,
                finish: stored.info.finish ?? null,
                invoked: invoked.length,
                errors,
                sleeps,
              }),
            )
            // A conversion exception must not masquerade as a successful single-attempt activity veto.
            expect(classifications).toHaveLength(consumed.filter((kind) => kind === "adapter").length)
            for (const markers of classifications) expect(markers).toEqual(["incomplete-stream"])
            expect(observed).toEqual({
              invocations: fixture.calls,
              consumed: fixture.sequence.slice(0, fixture.calls),
              retries: Array.from({ length: fixture.calls - 1 }, (_, i) => i + 1),
              result: fixture.result,
              handleError: fixture.error,
              storedError: fixture.error,
            })
            expect(errors).toEqual(fixture.error ? [fixture.error] : [])
            expect(sleeps.filter((timer) => timer.phase === "retry").map((timer) => timer.attempt)).toEqual(retries)
          }),
        { config: cfg },
      ),
    30_000,
  )
}

const g5Tokens = (scale: number) => ({
  total: 150 * scale,
  input: 70 * scale,
  output: 40 * scale,
  reasoning: 10 * scale,
  cache: { read: 20 * scale, write: 10 * scale },
})
const g5BaseTokens = { total: 40, input: 20, output: 10, reasoning: 2, cache: { read: 5, write: 5 } }
const g5Config = {
  ...cfg,
  provider: {
    test: {
      ...cfg.provider.test,
      models: {
        "test-model": {
          ...cfg.provider.test.models["test-model"],
          cost: { input: 2, output: 4, cache_read: 1, cache_write: 3 },
        },
      },
    },
  },
}
type G5Attempt = { steps: number; ending: "retry" | "fatal" | "stop" }
const g5Cases: { name: string; attempts: G5Attempt[] }[] = [
  {
    name: "open parts rollback before success",
    attempts: [
      { steps: 0, ending: "retry" },
      { steps: 1, ending: "stop" },
    ],
  },
  {
    name: "settled parts usage summary rollback",
    attempts: [
      { steps: 1, ending: "retry" },
      { steps: 1, ending: "stop" },
    ],
  },
  {
    name: "two discarded attempts remain isolated",
    attempts: [
      { steps: 1, ending: "retry" },
      { steps: 1, ending: "retry" },
      { steps: 1, ending: "stop" },
    ],
  },
  {
    name: "retain settled fatal last attempt",
    attempts: [
      { steps: 1, ending: "retry" },
      { steps: 1, ending: "fatal" },
    ],
  },
  {
    name: "retain open fatal without reviving discarded usage",
    attempts: [
      { steps: 1, ending: "retry" },
      { steps: 0, ending: "fatal" },
    ],
  },
  {
    name: "retain only sixth exhausted attempt",
    attempts: Array.from({ length: 6 }, () => ({ steps: 1, ending: "retry" })),
  },
  { name: "successful two step retention control", attempts: [{ steps: 2, ending: "stop" }] },
  { name: "fatal two step retention control", attempts: [{ steps: 2, ending: "fatal" }] },
  { name: "open fatal retention control", attempts: [{ steps: 0, ending: "fatal" }] },
]

for (const fixture of g5Cases) {
  let invocations = 0
  let target: { sessionID: SessionID; messageID: MessageID } | undefined
  const capture = () =>
    Effect.gen(function* () {
      if (!target) throw new Error("G5 target not initialized")
      const current = yield* MessageV2.get(target)
      if (current.info.role !== "assistant") throw new Error("G5 expected assistant")
      const session = yield* Session.Service
      const aggregate = yield* session.get(target.sessionID)
      if (aggregate.cost === undefined || !aggregate.tokens) throw new Error("G5 missing session aggregates")
      return {
        parts: structuredClone(current.parts),
        cost: current.info.cost,
        tokens: structuredClone(current.info.tokens),
        finish: current.info.finish ?? null,
        sessionCost: aggregate.cost,
        sessionTokens: structuredClone(aggregate.tokens),
      }
    })
  type View = Effect.Success<ReturnType<typeof capture>>
  let inspect: Effect.Effect<View, unknown> = Effect.die("G5 snapshot services not initialized")
  const entries: View[] = []
  const endings: View[] = []
  const summaryBefore: number[][] = []
  const owned: PartID[][] = []
  const constructed: { attempt: number; sessionID: string; messageID: string; done: ReturnType<typeof defer<void>> }[] =
    []
  const executed: { attempt: number; sessionID: string; messageID: string }[] = []
  const summaries = Layer.succeed(
    SessionSummary.Service,
    SessionSummary.Service.of({
      summarize: (input) => {
        // Construction is a separate record, not evidence that this Effect ran.
        const record = { ...input, attempt: invocations, done: defer<void>() }
        constructed.push(record)
        return Effect.sync(() => {
          executed.push({ attempt: record.attempt, sessionID: record.sessionID, messageID: record.messageID })
          record.done.resolve()
        })
      },
      diff: () => Effect.succeed([]),
      computeDiff: () => Effect.succeed([]),
    }),
  )
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        const attempt = ++invocations
        const plan = fixture.attempts[attempt - 1]
        if (!plan) return Stream.fail(new Error("G5 unexpected extra invocation"))
        return Stream.fromEffect(
          Effect.gen(function* () {
            // Durable checkpoint observation at source consumption, before this attempt emits anything.
            const entry = yield* inspect
            entries.push(entry)
            summaryBefore.push(executed.map((record) => record.attempt))
            const events: LLMEvent[] = []
            for (let step = 0; step < Math.max(1, plan.steps); step++) {
              const scale = attempt + step
              const textID = `g5-text-${attempt}-${step}`
              const reasoningID = `g5-reasoning-${attempt}-${step}`
              events.push(
                LLMEvent.stepStart({ index: step }),
                LLMEvent.reasoningStart({ id: reasoningID }),
                LLMEvent.reasoningDelta({ id: reasoningID, text: `reasoning ${attempt}/${step}` }),
                LLMEvent.textStart({ id: textID }),
                LLMEvent.textDelta({ id: textID, text: `text ${attempt}/${step}` }),
              )
              if (plan.steps === 0) continue
              events.push(
                LLMEvent.reasoningEnd({ id: reasoningID }),
                LLMEvent.textEnd({ id: textID }),
                LLMEvent.stepFinish({
                  index: step,
                  reason: "stop",
                  usage: {
                    inputTokens: 100 * scale,
                    outputTokens: 50 * scale,
                    reasoningTokens: 10 * scale,
                    cacheReadInputTokens: 20 * scale,
                    cacheWriteInputTokens: 10 * scale,
                    totalTokens: 150 * scale,
                  },
                }),
              )
            }
            if (plan.ending === "stop") events.push(g2Finish("stop"))
            return Stream.concat(
              Stream.fromIterable(events),
              Stream.fromEffect(
                Effect.gen(function* () {
                  const ending = yield* inspect
                  endings.push(ending)
                  const previous = new Set(entry.parts.map((part) => part.id))
                  owned.push(ending.parts.filter((part) => !previous.has(part.id)).map((part) => part.id))
                  if (plan.ending === "retry")
                    return yield* Effect.fail(
                      new APICallError({
                        message: "G5 ordinary failure",
                        url: "http://localhost/v1/chat/completions",
                        requestBodyValues: {},
                        statusCode: 503,
                        isRetryable: true,
                      }),
                    )
                  if (plan.ending === "fatal") return yield* Effect.fail(new Error("G5 terminal failure"))
                }),
              ).pipe(Stream.drain),
            )
          }),
        ).pipe(Stream.flatMap((stream) => stream))
      },
    }),
  )
  const g5 = testEffect(
    LayerNode.compile(root, [
      [SessionSummary.node, summaries],
      [
        RuntimeFlags.node,
        RuntimeFlags.layer({ experimentalEventSystem: true, disableDefaultPlugins: true, pure: true }),
      ],
      [LLM.node, source],
    ]),
  )
  g5.effect(
    `session.processor G5 ${fixture.name}`,
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            invocations = 0
            entries.length = 0
            endings.length = 0
            summaryBefore.length = 0
            owned.length = 0
            constructed.length = 0
            executed.length = 0
            const { processors, session, provider } = yield* boot()
            const database = yield* Database.Service
            inspect = capture().pipe(
              Effect.provideService(Session.Service, session),
              Effect.provideService(Database.Service, database),
            )
            const bridge = yield* EventV2Bridge.Service
            const chat = yield* session.create({})
            const parent = yield* user(chat.id, "rollback")
            const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
            delete msg.finish
            msg.cost = 0.125
            msg.tokens = structuredClone(g5BaseTokens)
            yield* session.updateMessage(msg)
            const existing = yield* session.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: chat.id,
              type: "text",
              text: "preexisting same assistant",
              time: { start: 1, end: 2 },
            })
            const other = yield* assistant(chat.id, parent.id, path.resolve(dir))
            const historyScale = 7
            other.cost = (390 * historyScale) / 1e6
            other.tokens = g5Tokens(historyScale)
            other.finish = "stop"
            yield* session.updateMessage(other)
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: other.id,
              sessionID: chat.id,
              type: "text",
              text: "other assistant untouched",
              time: { start: 1, end: 2 },
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: other.id,
              sessionID: chat.id,
              type: "step-finish",
              reason: "stop",
              cost: other.cost,
              tokens: structuredClone(other.tokens),
            })
            const otherBefore = yield* MessageV2.get({ sessionID: chat.id, messageID: other.id })
            const parentBefore = yield* MessageV2.get({ sessionID: chat.id, messageID: parent.id })
            target = { sessionID: chat.id, messageID: msg.id }
            const baseline = yield* capture()
            const { total: _historyTotal, ...historyTokens } = g5Tokens(historyScale)
            expect(Math.round(baseline.sessionCost * 1e6)).toBe(390 * historyScale)
            expect(baseline.sessionTokens).toEqual(historyTokens)
            const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
            expect(mdl.cost).toMatchObject({ input: 2, output: 4, cache: { read: 1, write: 3 } })
            let phase = "initial"
            let retry = 0
            const retries: number[] = []
            const errors: string[] = []
            const removed: { sessionID: string; messageID: string; partID: PartID; beforeInvocation: number }[] = []
            const off = yield* bridge.listen((event) => {
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id) {
                  phase = data.status.type
                  if (data.status.type === "retry") {
                    retry = data.status.attempt
                    retries.push(retry)
                  }
                }
              }
              if (event.type === Session.Event.Error.type) {
                const data = event.data as typeof Session.Event.Error.data.Type
                if (data.sessionID === chat.id && data.error) errors.push(data.error.name)
              }
              if (event.type === SessionV1.Event.PartRemoved.type) {
                const data = event.data as typeof SessionV1.Event.PartRemoved.data.Type
                if (data.sessionID === chat.id) removed.push({ ...data, beforeInvocation: invocations })
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const { exit } = yield* g4Run(
              handle.process({
                user: {
                  id: parent.id,
                  sessionID: chat.id,
                  role: "user",
                  time: parent.time,
                  agent: parent.agent,
                  model: ref,
                },
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [{ role: "user", content: "rollback" }],
                tools: {},
              }),
              () => ({ phase, attempt: retry, calls: invocations }),
            )
            expect(Exit.isSuccess(exit)).toBe(true)
            if (!Exit.isSuccess(exit)) throw new Error("G5 unexpected failed Exit")
            expect(invocations).toBe(fixture.attempts.length)
            expect(retries).toEqual(Array.from({ length: invocations - 1 }, (_, i) => i + 1))
            const last = fixture.attempts[invocations - 1]!
            const permitted = constructed.filter((record) => record.attempt === invocations)
            expect(permitted).toHaveLength(last.steps)
            const clock = yield* TestClock.testClockWith(Effect.succeed)
            // Await only retained work; waiting for discarded summaries would deadlock the future fix.
            yield* clock.withLive(
              awaitWithTimeout(
                Effect.forEach(permitted, (record) => Effect.promise(() => record.done.promise)),
                "G5 retained summary body did not execute",
                "5 seconds",
              ),
            )
            const final = yield* capture()
            const saved = yield* MessageV2.get(target)
            expect(saved.info.role).toBe("assistant")
            if (saved.info.role !== "assistant") throw new Error("G5 expected saved assistant")
            expect(saved.info.time.completed).toEqual(expect.any(Number))
            expect(saved.info.time.completed).toBe(handle.message.time.completed)
            expect(yield* MessageV2.get({ sessionID: chat.id, messageID: other.id })).toEqual(otherBefore)
            expect(yield* MessageV2.get({ sessionID: chat.id, messageID: parent.id })).toEqual(parentBefore)
            expect(final.parts.find((part) => part.id === existing.id)).toEqual(existing)
            for (let i = 0; i < owned.length; i++) {
              const plan = fixture.attempts[i]!
              const parts = endings[i]!.parts.filter((part) => owned[i]!.includes(part.id))
              expect(parts.filter((part) => part.type === "text")).toHaveLength(Math.max(1, plan.steps))
              expect(parts.filter((part) => part.type === "reasoning")).toHaveLength(Math.max(1, plan.steps))
              const steps = parts.filter((part) => part.type === "step-finish")
              expect(steps).toHaveLength(plan.steps)
              for (let j = 0; j < steps.length; j++) {
                expect(steps[j]!.tokens).toEqual(g5Tokens(i + 1 + j))
                expect(Math.round(steps[j]!.cost * 1e6)).toBe(390 * (i + 1 + j))
              }
            }
            for (const part of endings.at(-1)!.parts.filter((part) => owned.at(-1)!.includes(part.id))) {
              const retained = final.parts.find((candidate) => candidate.id === part.id)
              if ((part.type === "text" || part.type === "reasoning") && part.time?.end === undefined) {
                expect(last.steps).toBe(0)
                if (!part.time) throw new Error("G5 expected open part start time")
                // Open deltas are buffered; cleanup must persist the emitted content, not the earlier empty row.
                const text = `${part.type === "text" ? "text" : "reasoning"} ${invocations}/0`
                expect(retained).toEqual({ ...part, text, time: { ...part.time, end: expect.any(Number) } })
              } else {
                expect(retained).toEqual(part)
              }
            }
            const view = (value: View) => ({
              ids: value.parts.map((part) => part.id).sort(),
              costMicro: Math.round(value.cost * 1e6),
              tokens: value.tokens,
              finish: value.finish,
              sessionCostMicro: Math.round(value.sessionCost * 1e6),
              sessionTokens: value.sessionTokens,
            })
            const retainedScales = Array.from({ length: last.steps }, (_, i) => invocations + i)
            const sum = retainedScales.reduce((a, b) => a + b, 0)
            const { total: _total, ...aggregateTokens } = g5Tokens(historyScale + sum)
            const expectedError = last.ending === "stop" ? null : last.ending === "fatal" ? "UnknownError" : "APIError"
            if (expectedError)
              expect(saved.info.error).toMatchObject({
                name: expectedError,
                data: { message: last.ending === "fatal" ? "G5 terminal failure" : "G5 ordinary failure" },
              })
            const discarded = owned.slice(0, -1).flat().sort()
            const observed = {
              before: entries.map(view),
              summaryBefore,
              final: view(final),
              removed: removed.map((event) => event.partID).sort(),
              summaries: executed.map((record) => record.attempt),
              result: exit.value,
              error: saved.info.error?.name ?? null,
            }
            console.log(
              "G5 processor observation",
              JSON.stringify({
                name: fixture.name,
                invocations,
                retries,
                owned,
                ...observed,
                constructed: constructed.map((record) => record.attempt),
                errors,
              }),
            )
            expect(observed).toEqual({
              before: entries.map(() => view(baseline)),
              summaryBefore: entries.map(() => []),
              final: {
                ids: [...baseline.parts.map((part) => part.id), ...owned.at(-1)!].sort(),
                costMicro: 125000 + 390 * sum,
                tokens: last.steps ? g5Tokens(retainedScales.at(-1)!) : g5BaseTokens,
                finish: last.steps ? "stop" : null,
                sessionCostMicro: 390 * (historyScale + sum),
                sessionTokens: aggregateTokens,
              },
              removed: discarded,
              summaries: Array.from({ length: last.steps }, () => invocations),
              result: last.ending === "stop" ? "continue" : "stop",
              error: expectedError,
            })
            expect(handle.message.error?.name ?? null).toBe(expectedError)
            expect(errors).toEqual(expectedError ? [expectedError] : [])
            expect(handle.message.cost).toBe(saved.info.cost)
            expect(handle.message.tokens).toEqual(saved.info.tokens)
            for (const record of executed) {
              expect(record.sessionID).toBe(chat.id)
              expect(record.messageID).toBe(parent.id)
            }
            for (const event of removed) {
              expect(event.sessionID).toBe(chat.id)
              expect(event.messageID).toBe(msg.id)
              const owner = owned.findIndex((ids) => ids.includes(event.partID)) + 1
              expect(event.beforeInvocation).toBe(owner)
            }
          }),
        { config: g5Config },
      ),
    30_000,
  )
}

const g6Cases = [
  { name: "wire length", wire: true, reason: "length", overflow: false },
  { name: "wire length before compaction", wire: true, reason: "length", overflow: true },
  { name: "wire stop control", wire: true, reason: "stop", overflow: false },
  { name: "wire compaction control", wire: true, reason: "stop", overflow: true },
  { name: "length before later failure", wire: false, reason: "length", overflow: false },
  { name: "settled stop then failure control", wire: false, reason: "stop", overflow: false },
  { name: "intentional cutoff leaves lazy tail unconsumed", wire: false, reason: "stop", overflow: true },
] as const

for (const fixture of g6Cases) {
  let invocations = 0
  let tail = 0
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        invocations++
        if (invocations > 1) return Stream.fail(new Error("G6 unexpected invocation"))
        return Stream.concat(
          Stream.make(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "g6-text" }),
            LLMEvent.textDelta({ id: "g6-text", text: "G6 partial" }),
            LLMEvent.textEnd({ id: "g6-text" }),
            LLMEvent.stepFinish({ index: 0, reason: fixture.reason, usage: { inputTokens: 100, outputTokens: 2 } }),
          ),
          Stream.suspend(() => {
            tail++
            return Stream.fail(new Error("G6 later failure"))
          }),
        )
      },
    }),
  )
  const g6 = testEffect(
    fixture.wire
      ? env
      : LayerNode.compile(
          LayerNode.group([root, LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })]),
          [...replacements, [LLM.node, source]],
        ),
  )
  g6.live(`session.processor G6 ${fixture.name}`, () =>
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          invocations = 0
          tail = 0
          const { processors, session, provider } = yield* boot()
          const events = yield* EventV2Bridge.Service
          const chat = yield* session.create({ title: "G6 pinned" })
          const parent = yield* user(chat.id, "terminal priority")
          const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
          delete msg.finish
          yield* session.updateMessage(msg)
          const base = yield* provider.getModel(ref.providerID, ref.modelID)
          const mdl = fixture.overflow ? { ...base, limit: { context: 20, output: 10 } } : base
          const errors: NonNullable<SessionV1.Assistant["error"]>[] = []
          const retries: number[] = []
          const off = yield* events.listen((event) => {
            if (event.type === Session.Event.Error.type) {
              const data = event.data as typeof Session.Event.Error.data.Type
              if (data.sessionID === chat.id && data.error) errors.push(data.error)
            }
            if (event.type === SessionStatus.Event.Status.type) {
              const data = event.data as typeof SessionStatus.Event.Status.data.Type
              if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status.attempt)
            }
            return Effect.void
          })
          yield* Effect.addFinalizer(() => off)
          if (fixture.wire)
            yield* llm.push(
              raw({
                chunks: [
                  { choices: [{ delta: { role: "assistant", content: "G6 partial" } }] },
                  {
                    choices: [{ delta: {}, finish_reason: fixture.reason }],
                    usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
                  },
                ],
              }),
            )
          const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
          const exit = yield* awaitWithTimeout(
            handle
              .process({
                user: parent,
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [{ role: "user", content: "terminal priority" }],
                tools: {},
              })
              .pipe(Effect.exit),
            "G6 processor did not finish",
            "10 seconds",
          )
          const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
          if (stored.info.role !== "assistant") throw new Error("G6 expected assistant")
          const calls = fixture.wire ? yield* llm.calls : invocations
          console.log(
            "G6 processor observation",
            JSON.stringify({
              name: fixture.name,
              calls,
              tail,
              retries,
              errors,
              result: Exit.isSuccess(exit) ? exit.value : "failure-exit",
              finish: stored.info.finish,
              error: stored.info.error ?? null,
              steps: stored.parts.filter((part) => part.type === "step-finish").map((part) => part.reason),
            }),
          )
          expect(Exit.isSuccess(exit)).toBe(true)
          if (!Exit.isSuccess(exit)) throw new Error("G6 unexpected failure Exit")
          expect(calls).toBe(1)
          expect(retries).toEqual([])
          expect(stored.info.time.completed).toEqual(expect.any(Number))
          expect(stored.info.time.completed).toBe(handle.message.time.completed)
          expect(stored.info.error).toEqual(handle.message.error)
          expect(stored.parts.filter((part) => part.type === "step-finish").map((part) => part.reason)).toEqual([
            fixture.reason,
          ])
          expect(stored.parts).toContainEqual(expect.objectContaining({ type: "text", text: "G6 partial" }))
          if (fixture.wire) expect(yield* llm.pending).toBe(0)
          if (!fixture.wire && fixture.reason === "stop") expect(tail).toBe(fixture.overflow ? 0 : 1)
          const expected: SessionV1.Assistant["error"] =
            fixture.reason === "length"
              ? { name: "MessageOutputLengthError", data: {} }
              : !fixture.wire && !fixture.overflow
                ? { name: "UnknownError", data: { message: "G6 later failure" } }
                : undefined
          expect({ result: exit.value, finish: stored.info.finish, error: stored.info.error ?? null, errors }).toEqual({
            result: expected ? "stop" : fixture.overflow ? "compact" : "continue",
            finish: fixture.reason,
            error: expected ?? null,
            errors: expected ? [expected] : [],
          })
        }),
      { config: (url) => providerCfg(url) },
    ),
  )
}

// G7 isolates classification from reactive admission; no prompt-loop recovery episode is simulated here.
const g7Await = <A, E, E2 = never, R = never>(
  run: Fiber.Fiber<A, E>,
  drive: Effect.Effect<unknown, E2, R> = Effect.void,
) =>
  Effect.gen(function* () {
    yield* drive
    return yield* awaitWithTimeout(Fiber.await(run), "G7 processor did not finish", "5 seconds")
  }).pipe(
    Effect.onExit((driver) =>
      Exit.isSuccess(driver)
        ? Effect.void
        : Effect.gen(function* () {
            // Live callers permit production's 250ms tool cleanup; cancel the actual processor, not a waiter.
            run.interruptUnsafe()
            const drain = yield* awaitWithTimeout(
              Fiber.await(run),
              "G7 failed-driver processor drain did not finish",
              "5 seconds",
            ).pipe(Effect.exit)
            if (Exit.isFailure(drain)) return yield* Effect.failCause(Cause.combine(driver.cause, drain.cause))
            // Fiber.await returns the processor Exit as a VALUE. A successful wait can still carry a
            // mixed failure+interrupt Cause; preserve it whole. Requested pure interruption is expected.
            if (Exit.isFailure(drain.value) && !Cause.hasInterruptsOnly(drain.value.cause)) {
              return yield* Effect.failCause(Cause.combine(driver.cause, drain.value.cause))
            }
          }),
    ),
  )

const g7Opaque = "opaque detail"
const g7TypedMessage = "prompt is too long: 213462 tokens > 200000 maximum"
const g7Metadata = { test: { marker: "G7 retained start" } }
const g7Tool = { id: "g7-tool", name: "lookup" }
const g7Call = LLMEvent.toolCall({
  ...g7Tool,
  providerExecuted: true,
  input: { query: "G7 retained input" },
  providerMetadata: g7Metadata,
})
const g7Cases = [
  { name: "classified opaque provider error", failure: "classified", auto: false, activity: "none" },
  { name: "unclassified opaque negative", failure: "unclassified", auto: false, activity: "none" },
  { name: "retryable opaque negative", failure: "retryable", auto: false, activity: "none" },
  { name: "typed early no output compacts", failure: "typed", auto: true, activity: "none" },
  { name: "typed step-start only compacts", failure: "typed", auto: true, activity: "step" },
  { name: "typed after empty text-start stops", failure: "typed", auto: true, activity: "text" },
  { name: "typed after empty reasoning-start stops", failure: "typed", auto: true, activity: "reasoning" },
  { name: "typed after tool-input-start stops", failure: "typed", auto: true, activity: "input" },
  { name: "typed after orphan normalized tool-call stops", failure: "typed", auto: true, activity: "orphan" },
  { name: "typed after complete tool lifecycle stops", failure: "typed", auto: true, activity: "completed" },
  { name: "typed early auto false stops", failure: "typed", auto: false, activity: "none" },
] as const

for (const fixture of g7Cases) {
  let invocations = 0
  let failures = 0
  const emitted: LLMEvent[] = []
  let before: SessionV1.Part[] = []
  let inspect: Effect.Effect<SessionV1.Part[]> = Effect.die("G7 snapshot service not initialized")
  const activity: LLMEvent[] =
    fixture.activity === "none"
      ? []
      : fixture.activity === "step"
        ? [LLMEvent.stepStart({ index: 0 })]
        : fixture.activity === "text"
          ? [LLMEvent.textStart({ id: "g7-text", providerMetadata: g7Metadata })]
          : fixture.activity === "reasoning"
            ? [LLMEvent.reasoningStart({ id: "g7-reasoning", providerMetadata: g7Metadata })]
            : fixture.activity === "input"
              ? [LLMEvent.toolInputStart(g7Tool)]
              : fixture.activity === "orphan"
                ? [g7Call]
                : [
                    LLMEvent.toolInputStart(g7Tool),
                    LLMEvent.toolInputDelta({ ...g7Tool, text: '{"query":"G7 retained input"}' }),
                    LLMEvent.toolInputEnd(g7Tool),
                    g7Call,
                    LLMEvent.toolResult({
                      ...g7Tool,
                      providerExecuted: true,
                      result: {
                        type: "json",
                        value: {
                          title: "G7 completed lookup",
                          output: "G7 retained result",
                          metadata: { source: "G7", nested: { retained: true } },
                        },
                      },
                    }),
                  ]
  const normalized = LLMEvent.providerError({
    message: g7Opaque,
    ...(fixture.failure === "classified" ? { classification: "context-overflow" as const } : {}),
    ...(fixture.failure === "retryable" ? { retryable: true } : {}),
  })
  // Same real APICallError shape as the existing message-v2 provider-message regression.
  const typed = new APICallError({
    message: g7TypedMessage,
    url: "http://localhost:1/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseHeaders: { "content-type": "application/json" },
    isRetryable: false,
  })
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () =>
        Stream.suspend(() => {
          // Count actual lazy executions, including any out-of-plan invocation, not stream construction.
          invocations++
          if (invocations > 1) return Stream.fail(new Error("G7 unexpected extra invocation"))
          return Stream.concat(
            Stream.fromIterable(activity),
            Stream.unwrap(
              Effect.gen(function* () {
                // This tail executes after activity handlers return, including active-tool retirement.
                before = structuredClone(yield* inspect)
                failures++
                return fixture.failure === "typed" ? Stream.fail(typed) : Stream.make(normalized)
              }),
            ),
          ).pipe(Stream.tap((event) => Effect.sync(() => emitted.push(structuredClone(event)))))
        }),
    }),
  )
  const g7 = testEffect(LayerNode.compile(root, [...replacements, [LLM.node, source]]))
  g7.live(`session.processor G7 ${fixture.name}`, () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          invocations = 0
          failures = 0
          emitted.length = 0
          before = []
          const { processors, session, provider } = yield* boot()
          const bridge = yield* EventV2Bridge.Service
          const chat = yield* session.create({ title: "G7 pinned overflow" })
          // Two ordinary users establish actual old history, not a synthetic compaction marker.
          const old = yield* user(chat.id, "G7 ordinary old history")
          const parent = yield* user(chat.id, "G7 current request")
          const history = yield* MessageV2.get({ sessionID: chat.id, messageID: old.id })
          const current = yield* MessageV2.get({ sessionID: chat.id, messageID: parent.id })
          const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
          delete msg.finish
          yield* session.updateMessage(msg)
          const database = yield* Database.Service
          inspect = MessageV2.parts(msg.id).pipe(Effect.provideService(Database.Service, database))
          const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
          const errors: (typeof Session.Event.Error.data.Type)[] = []
          const retries: (typeof SessionStatus.Event.Status.data.Type)[] = []
          const off = yield* bridge.listen((event) => {
            if (event.type === Session.Event.Error.type) {
              const data = event.data as typeof Session.Event.Error.data.Type
              if (data.sessionID === chat.id) errors.push(structuredClone(data))
            }
            if (event.type === SessionStatus.Event.Status.type) {
              const data = event.data as typeof SessionStatus.Event.Status.data.Type
              if (data.sessionID === chat.id && data.status.type === "retry") retries.push(structuredClone(data))
            }
            return Effect.void
          })
          yield* Effect.addFinalizer(() => off)
          const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
          const run = yield* handle
            .process({
              user: parent,
              sessionID: chat.id,
              model: mdl,
              agent: agent(),
              system: [],
              messages: [
                { role: "user", content: "G7 ordinary old history" },
                { role: "user", content: "G7 current request" },
              ],
              tools: {},
            })
            .pipe(Effect.forkChild)
          const exit = yield* g7Await(run)
          const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
          if (stored.info.role !== "assistant") throw new Error("G7 expected assistant")
          console.log(
            "G7 processor observation",
            JSON.stringify({
              name: fixture.name,
              planned: 1,
              invocations,
              failures,
              emitted,
              before,
              parts: stored.parts,
              retries,
              errors,
              result: Exit.isSuccess(exit) ? exit.value : "failure-exit",
              finish: stored.info.finish ?? null,
              error: stored.info.error ?? null,
            }),
          )
          expect(Exit.isSuccess(exit)).toBe(true)
          if (!Exit.isSuccess(exit)) throw new Error("G7 unexpected processor failure Exit")
          expect(invocations).toBe(1)
          expect(failures).toBe(1)
          expect(retries).toEqual([])
          expect(emitted).toEqual(fixture.failure === "typed" ? activity : [...activity, normalized])
          expect(stored.info.time.completed).toEqual(expect.any(Number))
          expect(stored.info.time.completed).toBe(handle.message.time.completed)
          expect(stored.info.finish).toBe(handle.message.finish)
          expect(stored.info.error).toEqual(handle.message.error)
          expect(stored.parts.some((part) => part.type === "step-finish")).toBe(false)
          expect(yield* MessageV2.get({ sessionID: chat.id, messageID: old.id })).toEqual(history)
          expect(yield* MessageV2.get({ sessionID: chat.id, messageID: parent.id })).toEqual(current)
          expect(history.info.role).toBe("user")
          expect(current.info.role).toBe("user")
          expect(history.parts.map((part) => part.type)).toEqual(["text"])
          expect(current.parts.map((part) => part.type)).toEqual(["text"])
          expect(old.id).not.toBe(parent.id)
          expect(before.map((part) => part.type)).toEqual(
            fixture.activity === "none"
              ? []
              : [
                  fixture.activity === "step"
                    ? "step-start"
                    : fixture.activity === "text" || fixture.activity === "reasoning"
                      ? fixture.activity
                      : "tool",
                ],
          )
          expect(stored.parts.map((part) => part.id)).toEqual(before.map((part) => part.id))
          for (const part of before) {
            const retained = stored.parts.find((candidate) => candidate.id === part.id)
            if (part.type === "text" || part.type === "reasoning") {
              expect(part.text).toBe("")
              expect(part.metadata).toEqual(g7Metadata)
              expect(part.time?.start).toEqual(expect.any(Number))
              expect(part.time?.end).toBeUndefined()
              expect(retained).toEqual({ ...part, time: { start: part.time!.start, end: expect.any(Number) } })
              if (retained?.type !== "text" && retained?.type !== "reasoning")
                throw new Error("G7 missing content part")
              expect(retained.time!.end!).toBeGreaterThanOrEqual(part.time!.start)
              continue
            }
            if (part.type !== "tool") {
              expect(retained).toEqual(part)
              continue
            }
            expect(part.callID).toBe(g7Tool.id)
            expect(part.tool).toBe(g7Tool.name)
            // tool-input-start has no providerExecuted field; only the normalized call adds it.
            expect(part.metadata).toEqual(
              fixture.activity === "input" ? undefined : { ...g7Metadata, providerExecuted: true },
            )
            if (fixture.activity === "completed") {
              expect(part.state).toEqual({
                status: "completed",
                input: { query: "G7 retained input" },
                output: "G7 retained result",
                title: "G7 completed lookup",
                metadata: { source: "G7", nested: { retained: true } },
                time: { start: expect.any(Number), end: expect.any(Number) },
              })
              expect(retained).toEqual(part)
              continue
            }
            expect(part.state).toEqual(
              fixture.activity === "input"
                ? { status: "pending", input: {}, raw: "" }
                : { status: "running", input: { query: "G7 retained input" }, time: { start: expect.any(Number) } },
            )
            const start = part.state.status === "running" ? part.state.time.start : expect.any(Number)
            expect(retained).toEqual({
              ...part,
              state: {
                ...part.state,
                status: "error",
                error: "Tool execution aborted",
                metadata: { interrupted: true },
                time: { start, end: expect.any(Number) },
              },
            })
            if (retained?.type !== "tool" || retained.state.status !== "error")
              throw new Error("G7 missing settled tool")
            expect(retained.state.time.end).toBeGreaterThanOrEqual(retained.state.time.start)
          }
          const overflow = fixture.failure === "typed" || fixture.failure === "classified"
          const expectedError: NonNullable<SessionV1.Assistant["error"]> = overflow
            ? {
                name: "ContextOverflowError",
                data: { message: fixture.failure === "typed" ? g7TypedMessage : g7Opaque },
              }
            : { name: "UnknownError", data: { message: g7Opaque } }
          const compact = fixture.auto && (fixture.activity === "none" || fixture.activity === "step")
          // Full event data is also independent classification evidence on successful compact controls.
          // The combined oracle keeps every terminal mismatch visible in the same RED assertion.
          expect({
            result: exit.value,
            finish: stored.info.finish ?? null,
            error: stored.info.error ?? null,
            errors,
          }).toEqual({
            result: compact ? "compact" : "stop",
            finish: overflow && !compact ? "error" : null,
            error: compact ? null : expectedError,
            errors: [{ sessionID: chat.id, error: expectedError }],
          })
        }),
      { config: { ...cfg, compaction: { auto: fixture.auto } } },
    ),
  )
}

for (const secondary of [false, true]) {
  let invocations = 0
  let ready: Deferred.Deferred<void> | undefined
  let inspect: Effect.Effect<SessionV1.Part[]> = Effect.die("G7 driver snapshot service not initialized")
  let before: SessionV1.Part[] = []
  const emitted: LLMEvent[] = []
  const start = LLMEvent.textStart({ id: "g7-driver-text", providerMetadata: g7Metadata })
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () =>
        Stream.suspend(() => {
          invocations++
          if (invocations > 1) return Stream.fail(new Error("G7 driver unexpected extra invocation"))
          return Stream.concat(
            Stream.make(start),
            Stream.fromEffect(
              Effect.gen(function* () {
                if (!ready) throw new Error("G7 driver not initialized")
                before = structuredClone(yield* inspect)
                yield* Deferred.succeed(ready, undefined)
                return yield* Effect.never
              }),
            ),
          ).pipe(Stream.tap((event) => Effect.sync(() => emitted.push(structuredClone(event)))))
        }),
    }),
  )
  const g7 = testEffect(LayerNode.compile(root, [...replacements, [LLM.node, source]]))
  g7.live(`session.processor G7 driver primary${secondary ? " plus completed-fiber secondary" : ""}`, () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          invocations = 0
          before = []
          emitted.length = 0
          ready = yield* Deferred.make<void>()
          const { processors, session, provider } = yield* boot()
          const bridge = yield* EventV2Bridge.Service
          const chat = yield* session.create({ title: "G7 driver failure control" })
          const parent = yield* user(chat.id, "G7 hanging processor")
          const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
          delete msg.finish
          yield* session.updateMessage(msg)
          const database = yield* Database.Service
          inspect = MessageV2.parts(msg.id).pipe(Effect.provideService(Database.Service, database))
          const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
          const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
          const primary = new Error("G7 injected driver failure")
          const cleanup = new Error("G7 injected completed-fiber secondary")
          const errors: (typeof Session.Event.Error.data.Type)[] = []
          const retries: number[] = []
          let realExit: Exit.Exit<unknown, unknown> | undefined
          let completedBeforeSecondary: number | undefined
          const off = yield* bridge.listen((event) => {
            if (event.type === Session.Event.Error.type) {
              const data = event.data as typeof Session.Event.Error.data.Type
              if (data.sessionID === chat.id) errors.push(structuredClone(data))
            }
            if (event.type === SessionStatus.Event.Status.type) {
              const data = event.data as typeof SessionStatus.Event.Status.data.Type
              if (data.sessionID === chat.id && data.status.type === "retry") retries.push(data.status.attempt)
            }
            return Effect.void
          })
          yield* Effect.addFinalizer(() => off)
          const run = yield* handle
            .process({
              user: parent,
              sessionID: chat.id,
              model: mdl,
              agent: agent(),
              system: [],
              messages: [{ role: "user", content: "G7 hanging processor" }],
              tools: {},
            })
            .pipe(
              Effect.onExit((exit) => Effect.sync(() => (realExit = exit))),
              // Test-only OUTER failure after real processor cleanup, not a production persistence fault.
              Effect.onExit(() =>
                secondary
                  ? Effect.gen(function* () {
                      completedBeforeSecondary = handle.message.time.completed
                      return yield* Effect.fail(cleanup)
                    })
                  : Effect.void,
              ),
              Effect.forkChild,
            )
          const driven = yield* g7Await(
            run,
            Effect.gen(function* () {
              yield* awaitWithTimeout(Deferred.await(ready!), "G7 driver processor did not become active", "5 seconds")
              return yield* Effect.fail(primary)
            }),
          ).pipe(Effect.exit)
          const ended = yield* awaitWithTimeout(Fiber.await(run), "G7 driver control did not drain", "5 seconds")
          const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
          console.log(
            "G7 driver observation",
            JSON.stringify({
              secondary,
              invocations,
              retries,
              realInterrupted: realExit && Exit.isFailure(realExit) && Cause.hasInterruptsOnly(realExit.cause),
              fiberReasons: Exit.isFailure(ended) ? ended.cause.reasons.map((reason) => reason._tag) : [],
              driverReasons: Exit.isFailure(driven) ? driven.cause.reasons.map((reason) => reason._tag) : [],
              completed: stored.info.time,
              completedBeforeSecondary,
            }),
          )
          expect(Exit.isFailure(driven)).toBe(true)
          expect(Exit.isFailure(ended)).toBe(true)
          expect(realExit && Exit.isFailure(realExit) && Cause.hasInterruptsOnly(realExit.cause)).toBe(true)
          if (!Exit.isFailure(driven) || !Exit.isFailure(ended))
            throw new Error("G7 expected driver and processor failure")
          expect(driven.cause.reasons.filter(Cause.isFailReason).some((reason) => reason.error === primary)).toBe(true)
          expect(driven.cause.reasons).toEqual([
            ...Cause.fail(primary).reasons,
            ...(secondary ? ended.cause.reasons : []),
          ])
          if (secondary) {
            expect(ended.cause.reasons.filter(Cause.isFailReason).some((reason) => reason.error === cleanup)).toBe(true)
            expect(driven.cause.reasons.filter(Cause.isFailReason).some((reason) => reason.error === cleanup)).toBe(
              true,
            )
            expect(completedBeforeSecondary).toEqual(expect.any(Number))
          } else {
            expect(Cause.hasInterruptsOnly(ended.cause)).toBe(true)
            expect(Cause.hasInterrupts(driven.cause)).toBe(false)
          }
          expect(invocations).toBe(1)
          expect(retries).toEqual([])
          expect(emitted).toEqual([start])
          expect(before).toHaveLength(1)
          expect(before[0]).toMatchObject({
            type: "text",
            text: "",
            metadata: g7Metadata,
            time: { start: expect.any(Number) },
          })
          const part = before[0]!
          if (part.type !== "text" || !part.time) throw new Error("G7 driver missing open text")
          expect(part.time.end).toBeUndefined()
          expect(stored.parts).toEqual([{ ...part, time: { start: part.time.start, end: expect.any(Number) } }])
          expect(stored.info.role).toBe("assistant")
          if (stored.info.role !== "assistant") throw new Error("G7 driver expected assistant")
          const aborted: NonNullable<SessionV1.Assistant["error"]> = {
            name: "MessageAbortedError",
            data: { message: "Aborted" },
          }
          expect(stored.info.error).toEqual(aborted)
          expect(handle.message.error).toEqual(aborted)
          expect(errors).toEqual([{ sessionID: chat.id, error: aborted }])
          expect(stored.info.finish).toBeUndefined()
          expect(handle.message.finish).toBeUndefined()
          expect(stored.info.time.completed).toEqual(expect.any(Number))
          expect(stored.info.time.completed).toBe(handle.message.time.completed)
          if (secondary) expect(stored.info.time.completed).toBe(completedBeforeSecondary)
        }),
      { config: cfg },
    ),
  )
}

// G8 injects persistent PRE-DELEGATION defects at the processor's captured Session writer boundary.
// Forwarded calls retain the real Session -> event transaction -> projector path. This models writer
// entry failure, not a physical SQL/disk fault, a failing observer, or an after-commit notification.
type G8Write =
  | { method: "part"; input: SessionV1.Part; before: SessionV1.WithParts; blocked: boolean; returned: boolean }
  | { method: "message"; input: SessionV1.Info; before: SessionV1.WithParts; blocked: boolean; returned: boolean }

for (const ending of ["success", "fatal", "cancel"] as const) {
  for (const fault of ["healthy", "partflush", "finalmessage"] as const) {
    let invocations = 0
    let boundaries = 0
    let cancellations = 0
    let partAttempts = 0
    let messageAttempts = 0
    let faultHits = 0
    let armed = false
    let targetSession: SessionID | undefined
    let targetMessage: MessageID | undefined
    let targetPart: PartID | undefined
    let ready: Deferred.Deferred<void> | undefined
    const checkpoints: SessionV1.WithParts[] = []
    let inspect: Effect.Effect<SessionV1.WithParts> = Effect.die("G8 snapshot service not initialized")
    const writes: G8Write[] = []
    const emitted: LLMEvent[] = []
    const primary = new Error("G8 original nonretryable fatal")
    const storage = new Error(`G8 ${ending} ${fault} writer unavailable`)
    const metadata = { test: { marker: "G8 retained start", nested: { preserved: true } } }
    const deltaMetadata = { test: { marker: "G8 emitted delta", nested: { preserved: true } } }
    const content = "G8 buffered payload"
    const call = { id: "g8-active-tool", name: "lookup" }
    const toolInput = { query: "G8 active input", nested: { retained: true } }
    const targetType = ending === "success" ? "text" : ending === "fatal" ? "reasoning" : "tool"
    // This is a normalized seam, not wire/SDK evidence. The success step really settles with stop;
    // step-finish closes reasoning but leaves currentText for cleanup when text-end is absent.
    const head: LLMEvent[] =
      ending === "success"
        ? [
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "g8-text", providerMetadata: metadata }),
            LLMEvent.textDelta({ id: "g8-text", text: content, providerMetadata: deltaMetadata }),
            LLMEvent.stepFinish({ index: 0, reason: "stop" }),
            LLMEvent.finish({ reason: "stop" }),
          ]
        : ending === "fatal"
          ? [
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.reasoningStart({ id: "g8-reasoning", providerMetadata: metadata }),
              LLMEvent.reasoningDelta({ id: "g8-reasoning", text: content, providerMetadata: deltaMetadata }),
            ]
          : [
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.toolInputStart(call),
              LLMEvent.toolInputDelta({ ...call, text: JSON.stringify(toolInput) }),
              LLMEvent.toolInputEnd(call),
              LLMEvent.toolCall({ ...call, input: toolInput, providerExecuted: true, providerMetadata: metadata }),
            ]
    const source = Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: () =>
          Stream.suspend(() => {
            invocations++
            if (invocations > 1) return Stream.fail(new Error("G8 unexpected extra invocation"))
            return Stream.concat(
              Stream.fromIterable(head),
              Stream.unwrap(
                Effect.gen(function* () {
                  // Lazy tail: every head handler has returned. The snapshot Effect closes over the
                  // actual Database service, so no database requirement leaks into LLM.Service.stream.
                  boundaries++
                  const before = structuredClone(yield* inspect)
                  checkpoints.push(before)
                  targetPart = before.parts.find((part) => part.type === targetType)?.id
                  if (!targetPart || !ready) throw new Error("G8 terminal boundary not initialized")
                  armed = true
                  if (ending === "cancel") {
                    yield* Deferred.succeed(ready, undefined)
                    return Stream.fromEffect(Effect.never)
                  }
                  return ending === "fatal" ? Stream.fail(primary) : Stream.empty
                }),
              ),
            ).pipe(Stream.tap((event) => Effect.sync(() => emitted.push(structuredClone(event)))))
          }),
      }),
    )
    const implementation = SessionProcessor.node.implementation
    if (!Layer.isLayer(implementation)) throw new Error("G8 processor implementation is not a Layer")
    const processor = {
      ...SessionProcessor.node,
      // Decorate the INPUT before processor construction captures it; fixture setup and readback
      // still use the original Session node. Keeping the original dependencies avoids a self-cycle.
      implementation: Layer.updateService(implementation, Session.Service, (real) =>
        Session.Service.of({
          ...real,
          updatePart: <T extends SessionV1.Part>(part: T): Effect.Effect<T> =>
            Effect.gen(function* () {
              if (
                !armed ||
                part.sessionID !== targetSession ||
                part.messageID !== targetMessage ||
                part.id !== targetPart
              )
                return yield* real.updatePart(part)
              partAttempts++
              const write: G8Write = {
                method: "part",
                input: structuredClone(part),
                before: structuredClone(yield* inspect),
                blocked: fault === "partflush",
                returned: false,
              }
              writes.push(write)
              if (write.blocked) {
                faultHits++
                return yield* Effect.die(storage)
              }
              const result = yield* real.updatePart(part)
              write.returned = true
              return result
            }),
          updateMessage: <T extends SessionV1.Info>(message: T): Effect.Effect<T> =>
            Effect.gen(function* () {
              if (
                !armed ||
                message.sessionID !== targetSession ||
                message.id !== targetMessage ||
                message.role !== "assistant" ||
                message.time.completed === undefined
              )
                return yield* real.updateMessage(message)
              messageAttempts++
              const write: G8Write = {
                method: "message",
                input: structuredClone(message),
                before: structuredClone(yield* inspect),
                blocked: fault === "finalmessage",
                returned: false,
              }
              writes.push(write)
              if (write.blocked) {
                faultHits++
                return yield* Effect.die(storage)
              }
              const result = yield* real.updateMessage(message)
              write.returned = true
              return result
            }),
        }),
      ),
    }
    const g8 = testEffect(
      LayerNode.compile(root, [...replacements, [LLM.node, source], [SessionProcessor.node, processor]]),
    )
    g8.live(`session.processor G8 ${ending} ${fault}`, () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            invocations = 0
            boundaries = 0
            cancellations = 0
            partAttempts = 0
            messageAttempts = 0
            faultHits = 0
            armed = false
            targetSession = undefined
            targetMessage = undefined
            targetPart = undefined
            checkpoints.length = 0
            writes.length = 0
            emitted.length = 0
            ready = yield* Deferred.make<void>()
            const { processors, session, provider } = yield* boot()
            const bridge = yield* EventV2Bridge.Service
            const chat = yield* session.create({ title: "G8 final writer failures" })
            const old = yield* user(chat.id, "G8 unrelated history retained verbatim")
            const parent = yield* user(chat.id, "G8 current request")
            const history = yield* MessageV2.get({ sessionID: chat.id, messageID: old.id })
            const current = yield* MessageV2.get({ sessionID: chat.id, messageID: parent.id })
            const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
            delete msg.finish
            yield* session.updateMessage(msg)
            targetSession = chat.id
            targetMessage = msg.id
            const database = yield* Database.Service
            inspect = MessageV2.get({ sessionID: chat.id, messageID: msg.id }).pipe(
              Effect.orDie,
              Effect.provideService(Database.Service, database),
            )
            const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
            const errors: (typeof Session.Event.Error.data.Type)[] = []
            const retries: number[] = []
            const states: string[] = []
            const off = yield* bridge.listen((event) => {
              if (event.type === Session.Event.Error.type) {
                const data = event.data as typeof Session.Event.Error.data.Type
                if (data.sessionID === chat.id) errors.push(structuredClone(data))
              }
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id) {
                  states.push(data.status.type)
                  if (data.status.type === "retry") retries.push(data.status.attempt)
                }
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const run = yield* handle
              .process({
                user: parent,
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [
                  { role: "user", content: "G8 unrelated history retained verbatim" },
                  { role: "user", content: "G8 current request" },
                ],
                tools: {},
              })
              .pipe(Effect.forkChild)
            const exit = yield* g7Await(
              run,
              ending === "cancel"
                ? Effect.gen(function* () {
                    const observation = yield* awaitWithTimeout(
                      Deferred.await(ready!).pipe(
                        Effect.as("ready" as const),
                        Effect.raceFirst(Fiber.await(run).pipe(Effect.as("completed" as const))),
                      ),
                      "G8 cancellation readiness did not finish",
                      "5 seconds",
                    )
                    if (observation !== "ready") throw new Error("G8 processor completed before cancellation readiness")
                    cancellations++
                    run.interruptUnsafe()
                  })
                : Effect.void,
            )
            const stored = yield* inspect
            const before = checkpoints[0]
            const reasons = Exit.isFailure(exit) ? exit.cause.reasons : []
            const hasPrimary = reasons.some(
              (reason) =>
                (Cause.isFailReason(reason) && reason.error === primary) ||
                (Cause.isDieReason(reason) && reason.defect === primary),
            )
            const hasStorage = reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === storage)
            const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
            console.log(
              "G8 processor observation",
              JSON.stringify({
                ending,
                fault,
                planned: 1,
                invocations,
                boundaries,
                cancellations,
                partAttempts,
                messageAttempts,
                faultHits,
                emitted,
                before,
                writes,
                stored,
                memory: handle.message,
                errors,
                retries,
                states,
                result: Exit.isSuccess(exit) ? exit.value : "failure-exit",
                reasons: reasons.map((reason) => reason._tag),
                interrupted,
                hasPrimary,
                hasStorage,
              }),
            )
            // All structural/persistence assertions precede the deliberately stronger failure-Cause
            // oracle. No assert runs while the processor is still active; g7Await retains its own
            // existing bounded failure drain. An idle event is recorded, never used as durability proof.
            expect(invocations).toBe(1)
            expect(boundaries).toBe(1)
            expect(checkpoints).toHaveLength(1)
            expect(cancellations).toBe(ending === "cancel" ? 1 : 0)
            expect(retries).toEqual([])
            expect(emitted).toEqual(head)
            expect(armed).toBe(true)
            expect(partAttempts).toBe(1)
            expect(messageAttempts).toBe(fault === "partflush" ? 0 : 1)
            expect(faultHits).toBe(fault === "healthy" ? 0 : 1)
            expect(writes.map((write) => write.method)).toEqual(fault === "partflush" ? ["part"] : ["part", "message"])
            expect(yield* MessageV2.get({ sessionID: chat.id, messageID: old.id })).toEqual(history)
            expect(yield* MessageV2.get({ sessionID: chat.id, messageID: parent.id })).toEqual(current)
            if (!before || before.info.role !== "assistant" || stored.info.role !== "assistant")
              throw new Error("G8 expected assistant snapshots")
            const initial = before.parts.find((part) => part.id === targetPart)
            const partWrite = writes.find((write) => write.method === "part")
            if (!initial || !partWrite || partWrite.method !== "part")
              throw new Error("G8 missing cleanup part attempt")
            expect(partWrite.before).toEqual(before)
            expect(partWrite.blocked).toBe(fault === "partflush")
            expect(partWrite.returned).toBe(fault !== "partflush")
            expect(initial.type).toBe(targetType)
            if (initial.type === "text" || initial.type === "reasoning") {
              expect(initial.text).toBe("")
              expect(initial.metadata).toEqual(metadata)
              expect(initial.time?.start).toEqual(expect.any(Number))
              expect(initial.time?.end).toBeUndefined()
              expect(partWrite.input).toEqual({
                ...initial,
                text: content,
                metadata: deltaMetadata,
                time: { start: initial.time!.start, end: expect.any(Number) },
              })
              if (partWrite.input.type !== "text" && partWrite.input.type !== "reasoning")
                throw new Error("G8 wrong content cleanup input")
              expect(partWrite.input.time!.end!).toBeGreaterThanOrEqual(initial.time!.start)
            } else {
              if (initial.type !== "tool" || initial.state.status !== "running")
                throw new Error("G8 expected active running tool")
              expect(initial.callID).toBe(call.id)
              expect(initial.tool).toBe(call.name)
              expect(initial.metadata).toEqual({ ...metadata, providerExecuted: true })
              expect(initial.state).toEqual({
                status: "running",
                input: toolInput,
                time: { start: expect.any(Number) },
              })
              expect(partWrite.input).toEqual({
                ...initial,
                state: {
                  ...initial.state,
                  status: "error",
                  error: "Tool execution aborted",
                  metadata: { interrupted: true },
                  time: { start: initial.state.time.start, end: expect.any(Number) },
                },
              })
              if (partWrite.input.type !== "tool" || partWrite.input.state.status !== "error")
                throw new Error("G8 wrong tool cleanup input")
              expect(partWrite.input.state.time.end).toBeGreaterThanOrEqual(initial.state.time.start)
            }
            const retained: SessionV1.Part[] = before.parts.map((part) =>
              part.id === targetPart && fault !== "partflush" ? partWrite.input : part,
            )
            // Full payload equality keeps unrelated/settled parts and every prior successful cleanup
            // write. On a blocked content flush, buffered delta is NOT expected to become durable.
            expect(stored.parts).toEqual(retained)
            const steps = stored.parts.filter((part) => part.type === "step-finish")
            expect(steps.map((part) => part.reason)).toEqual(ending === "success" ? ["stop"] : [])
            expect(before.parts.map((part) => part.type)).toEqual(
              ending === "success" ? ["step-start", "text", "step-finish"] : ["step-start", targetType],
            )
            const expectedError: NonNullable<SessionV1.Assistant["error"]> | undefined =
              ending === "success"
                ? undefined
                : ending === "fatal"
                  ? { name: "UnknownError", data: { message: primary.message } }
                  : { name: "MessageAbortedError", data: { message: "Aborted" } }
            const finish = ending === "success" ? "stop" : undefined
            expect(handle.message.finish).toBe(finish)
            expect(stored.info.finish).toBe(finish)
            expect(handle.message.error).toEqual(expectedError)
            expect(errors).toEqual(expectedError ? [{ sessionID: chat.id, error: expectedError }] : [])
            expect(handle.message.structured).toBeUndefined()
            expect(stored.info.structured).toBeUndefined()
            expect(before.info.error).toBeUndefined()
            expect(before.info.time.completed).toBeUndefined()
            if (fault === "partflush") {
              expect(handle.message.time.completed).toBeUndefined()
            } else {
              expect(handle.message.time.completed).toEqual(expect.any(Number))
              const messageWrite = writes.find((write) => write.method === "message")
              if (!messageWrite || messageWrite.method !== "message")
                throw new Error("G8 missing final message attempt")
              expect(messageWrite.before).toEqual({ info: before.info, parts: retained })
              expect(messageWrite.input).toEqual({
                ...before.info,
                ...(expectedError ? { error: expectedError } : {}),
                time: { ...before.info.time, completed: handle.message.time.completed },
              })
              expect(messageWrite.blocked).toBe(fault === "finalmessage")
              expect(messageWrite.returned).toBe(fault === "healthy")
            }
            expect(stored.info.error).toEqual(fault === "healthy" ? expectedError : undefined)
            if (fault === "healthy") {
              expect(stored.info.time.completed).toBe(handle.message.time.completed)
              expect(stored.info).toEqual({
                ...before.info,
                ...(expectedError ? { error: expectedError } : {}),
                time: { ...before.info.time, completed: handle.message.time.completed },
              })
              if (ending === "cancel") {
                expect(Exit.isFailure(exit)).toBe(true)
                if (!Exit.isFailure(exit)) throw new Error("G8 expected healthy cancellation Exit")
                expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
              } else {
                expect(Exit.isSuccess(exit)).toBe(true)
                if (!Exit.isSuccess(exit)) throw new Error("G8 expected healthy processor result")
                expect(exit.value).toBe(ending === "success" ? "continue" : "stop")
              }
              return
            }
            expect(stored.info.time.completed).toBeUndefined()
            expect(stored.info).toEqual(before.info)
            // Desired policy: finalization faults must not lose the raw fatal failure or an original
            // interrupt. Parsed assistant.error and an error/idle notification are separate evidence.
            expect({ failed: Exit.isFailure(exit), hasStorage, hasPrimary, interrupted }).toEqual({
              failed: true,
              hasStorage: true,
              hasPrimary: ending === "fatal",
              interrupted: ending === "cancel",
            })
          }),
        { config: cfg },
      ),
    )
  }
}

it.live("session.processor effect tests compact on structured context overflow", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "compact json" }],
          tools: {},
        })

        expect(value).toBe("compact")
        expect(yield* llm.calls).toBe(1)
        expect(handle.message.error).toBeUndefined()
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests complete AI SDK tool calls when native flag is off", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.tool("lookup", { query: "weather" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "tool")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "tool" }],
          tools: {
            lookup: tool({
              description: "Look up information",
              inputSchema: z.object({ query: z.string() }),
              execute: async (input) => ({
                title: "Weather lookup",
                output: `result:${input.query}`,
                metadata: { source: "test" },
              }),
            }),
          },
        })

        const parts = yield* MessageV2.parts(msg.id)
        const call = parts.find((part): part is SessionV1.ToolPart => part.type === "tool")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(1)
        expect(call?.callID).toBe("call_1")
        expect(call?.tool).toBe("lookup")
        expect(call?.state.status).toBe("completed")
        if (call?.state.status !== "completed") return
        expect(call.state.input).toEqual({ query: "weather" })
        expect(call.state.output).toBe("result:weather")
        expect(call.state.title).toBe("Weather lookup")
        expect(call.state.metadata).toEqual({ source: "test" })
        expect(call.state.time.start).toBeDefined()
        expect(call.state.time.end).toBeDefined()
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests mark pending tools as aborted on cleanup", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const { processors, session, provider } = yield* boot()

        yield* llm.toolHang("bash", { cmd: "pwd" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "tool abort")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies SessionV1.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "tool abort" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* waitFor(
          MessageV2.parts(msg.id).pipe(
            Effect.map((parts) => parts.find((part): part is SessionV1.ToolPart => part.type === "tool")),
            Effect.provideService(Database.Service, database),
          ),
          "timed out waiting for tool part",
        )
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        const parts = yield* MessageV2.parts(msg.id)
        const call = parts.find((part): part is SessionV1.ToolPart => part.type === "tool")

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        }
        expect(yield* llm.calls).toBe(1)
        expect(call?.state.status).toBe("error")
        if (call?.state.status === "error") {
          expect(call.state.error).toBe("Tool execution aborted")
          expect(call.state.metadata?.interrupted).toBe(true)
          expect(call.state.time.end).toBeDefined()
        }
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests record aborted errors and idle state", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const seen = defer<void>()
        const { processors, session, provider } = yield* boot()
        const events = yield* EventV2Bridge.Service
        const sts = yield* SessionStatus.Service

        yield* llm.hang

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "abort")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const errs: string[] = []
        const off = yield* events.listen((evt) => {
          if (evt.type !== Session.Event.Error.type) return Effect.void
          const data = evt.data as typeof Session.Event.Error.data.Type
          if (data.sessionID !== chat.id || !data.error) return Effect.void
          errs.push(data.error.name)
          seen.resolve()
          return Effect.void
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies SessionV1.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "abort" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        yield* Effect.promise(() => seen.promise)
        const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
        const state = yield* sts.get(chat.id)
        yield* off

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        }
        expect(handle.message.error?.name).toBe("MessageAbortedError")
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.error?.name).toBe("MessageAbortedError")
        }
        expect(state).toMatchObject({ type: "idle" })
        expect(errs).toContain("MessageAbortedError")
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests mark interruptions aborted without manual abort", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const sts = yield* SessionStatus.Service

        yield* llm.hang

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "interrupt")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies SessionV1.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "interrupt" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
        const state = yield* sts.get(chat.id)

        expect(Exit.isFailure(exit)).toBe(true)
        expect(handle.message.error?.name).toBe("MessageAbortedError")
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.error?.name).toBe("MessageAbortedError")
        }
        expect(state).toMatchObject({ type: "idle" })
      }),
    { config: (url) => providerCfg(url) },
  ),
)

itProviderError.live("session.processor effect tests fail provider-executed error results", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const events = yield* EventV2Bridge.Service

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "provider tool error")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const seen: string[] = []
        const off = yield* events.listen((event) => {
          seen.push(event.type)
          return Effect.void
        })
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

        yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "provider tool error" }],
          tools: {},
        })
        yield* off

        const parts = yield* MessageV2.parts(msg.id)
        const call = parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
        expect(call?.state.status).toBe("error")
        if (call?.state.status === "error") expect(call.state.error).toBe("provider boom")
        expect(seen).toContain(MessageV2.Event.PartUpdated.type)
        expect(seen).toContain(MessageV2.Event.Updated.type)
        expect(seen.filter((type) => type.startsWith("session.next."))).toEqual([])
      }),
    { config: cfg },
  ),
)

itFragmentFailure.live("session.processor effect tests retain partial legacy parts without v2 events", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const events = yield* EventV2Bridge.Service

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "provider failure")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const seen: string[] = []
        const off = yield* events.listen((event) => {
          seen.push(event.type)
          return Effect.void
        })
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

        expect(
          yield* handle.process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies SessionV1.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "provider failure" }],
            tools: {},
          }),
        ).toBe("stop")
        yield* off

        const parts = yield* MessageV2.parts(msg.id)
        expect(parts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "partial" }),
            expect.objectContaining({ type: "reasoning", text: "thinking" }),
          ]),
        )
        expect(seen).toContain(MessageV2.Event.PartUpdated.type)
        expect(seen).toContain(Session.Event.Error.type)
        expect(seen.filter((type) => type.startsWith("session.next."))).toEqual([])
      }),
    { config: cfg },
  ),
)

// ---------------------------------------------------------------------------
// M2: processor recognition and terminal consumption (design §4, six groups)
// ---------------------------------------------------------------------------

// Same normalized shape the pinned adapter emits on wire EOF (M1-T02): the classified
// marker precedes the settlement, so a consumer that stops at the settlement still sees it.
const m2Marker = () =>
  LLMEvent.providerError({
    message: "Provider stream ended without a terminal finish event",
    retryable: false,
    classification: "incomplete-stream",
  })
const m2Unclassified = () => LLMEvent.providerError({ message: "M2 unclassified provider failure" })
// A settlement whose usage drives isOverflow for the tiny-limit model of the same fixture.
const m2OverflowStep = (reason: "unknown" | "stop") =>
  LLMEvent.stepFinish({ index: 0, reason, usage: { inputTokens: 100, outputTokens: 2, totalTokens: 102 } })

type M2Observed = {
  exit: Exit.Exit<SessionProcessor.Result, unknown>
  invocations: number
  retries: number[]
  errors: { sessionID: string; error: NonNullable<SessionV1.Assistant["error"]> }[]
  handle: SessionProcessor.Handle
  stored: { info: SessionV1.Assistant; parts: SessionV1.Part[] }
  status: SessionStatus.Info
}

// Shared settled-error oracle: EOF settlement writes error + finish=error, publishes the
// same error once and returns the session to idle. Rows add their own invocations/steps.
const m2Settled = (o: M2Observed, message: string) =>
  Effect.gen(function* () {
    expect(Exit.isSuccess(o.exit)).toBe(true)
    if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
    expect(o.exit.value).toBe("stop")
    const error = o.handle.message.error
    if (!error) throw new Error("M2 expected a settled error")
    expect(error).toEqual({ name: "UnknownError", data: { message } })
    expect(o.stored.info.error).toEqual(error)
    expect(o.handle.message.finish).toBe("error")
    expect(o.stored.info.finish).toBe("error")
    expect(o.errors).toEqual([{ sessionID: o.handle.message.sessionID, error }])
    expect(o.status).toMatchObject({ type: "idle" })
  })

const m2Steps = (o: M2Observed) =>
  o.stored.parts.filter((part) => part.type === "step-finish").map((part) => part.reason)

const m2Run = (
  name: string,
  fixture: { attempts: { events: LLMEvent[]; retryable?: boolean }[]; model?: { context: number; output: number } },
  assert: (input: M2Observed) => Effect.Effect<void>,
) => {
  const state = { invocations: 0 }
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        // Counted at stream construction: attempt count, not HTTP count.
        const attempt = fixture.attempts[state.invocations]
        state.invocations++
        if (!attempt) return Stream.fail(new Error("M2 unexpected extra invocation"))
        const events = Stream.fromIterable(attempt.events)
        if (!attempt.retryable) return events
        return Stream.concat(
          events,
          Stream.fail(
            new APICallError({
              message: "M2 retryable failure",
              url: "http://localhost/v1/chat/completions",
              requestBodyValues: {},
              statusCode: 503,
              isRetryable: true,
            }),
          ),
        )
      },
    }),
  )
  const m2 = testEffect(LayerNode.compile(root, [...replacements, [LLM.node, source]]))
  m2.effect(
    name,
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            state.invocations = 0
            const { processors, session, provider } = yield* boot()
            const bridge = yield* EventV2Bridge.Service
            const status = yield* SessionStatus.Service
            const chat = yield* session.create({})
            const parent = yield* user(chat.id, "m2")
            const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
            // finish is earned from events, never from the shared helper's seeded end_turn.
            delete msg.finish
            yield* session.updateMessage(msg)
            const base = yield* provider.getModel(ref.providerID, ref.modelID)
            const mdl = fixture.model ? { ...base, limit: fixture.model } : base
            let phase = "initial"
            let attempt = 0
            const retries: number[] = []
            const errors: { sessionID: string; error: NonNullable<SessionV1.Assistant["error"]> }[] = []
            const off = yield* bridge.listen((event) => {
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id) {
                  phase = data.status.type
                  if (data.status.type === "retry") {
                    attempt = data.status.attempt
                    retries.push(attempt)
                  }
                }
              }
              if (event.type === Session.Event.Error.type) {
                const data = event.data as typeof Session.Event.Error.data.Type
                if (data.sessionID === chat.id && data.error)
                  errors.push({ sessionID: data.sessionID, error: data.error })
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const { exit } = yield* g4Run(
              handle.process({
                user: {
                  id: parent.id,
                  sessionID: chat.id,
                  role: "user",
                  time: parent.time,
                  agent: parent.agent,
                  model: ref,
                },
                sessionID: chat.id,
                model: mdl,
                agent: agent(),
                system: [],
                messages: [{ role: "user", content: "m2" }],
                tools: {},
              }),
              () => ({ phase, attempt, calls: state.invocations }),
            )
            const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
            if (stored.info.role !== "assistant") throw new Error("M2 expected assistant message")
            yield* assert({
              exit,
              invocations: state.invocations,
              retries,
              errors,
              handle,
              stored: { info: stored.info, parts: stored.parts },
              status: yield* status.get(chat.id),
            })
          }),
        { config: cfg },
      ),
    30_000,
  )
}

// M2-T01: a classified marker is recorded, its settlement is still consumed, and EOF settles
// the message as provider. No compaction is requested, so the result is stop, not compact.
m2Run(
  "session.processor M2 T01 marker then settlement settles as provider",
  {
    attempts: [
      { events: [g2Start(), m2Marker(), g2Step("unknown"), g2Finish("unknown")] },
      { events: [g2Start(), g2Step("stop"), g2Finish("stop")] },
    ],
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
      expect(o.exit.value).toBe("continue")
      expect(o.invocations).toBe(2)
      expect(o.retries).toEqual([1])
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.errors).toEqual([])
      expect(o.handle.message.finish).toBe("stop")
      expect(o.stored.info.finish).toBe("stop")
      expect(m2Steps(o)).toEqual(["stop"])
    }),
)

// Same marker twice in one stream: the boolean dedupes, so settlement and publication stay single.
m2Run(
  "session.processor M2 T01 dual marker stays one settlement",
  {
    attempts: [
      { events: [g2Start(), m2Marker(), m2Marker(), g2Step("unknown"), g2Finish("unknown")] },
      { events: [g2Start(), g2Step("stop"), g2Finish("stop")] },
    ],
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
      expect(o.exit.value).toBe("continue")
      expect(o.invocations).toBe(2)
      expect(o.retries).toEqual([1])
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.errors).toEqual([])
      expect(o.handle.message.finish).toBe("stop")
      expect(o.stored.info.finish).toBe("stop")
      expect(m2Steps(o)).toEqual(["stop"])
    }),
)

// M2-T02: the compaction cutoff lands after the settlement, so both events are consumed and
// the settled error must outrank compaction (result selection reorder is load-bearing here).
m2Run(
  "session.processor M2 T02 marker survives overflow cutoff and keeps the settled error",
  {
    attempts: [{ events: [g2Start(), m2Marker(), m2OverflowStep("unknown"), g2Finish("unknown")] }],
    model: { context: 20, output: 10 },
  },
  (o) =>
    Effect.gen(function* () {
      yield* m2Settled(o, "provider")
      expect(o.invocations).toBe(1)
      expect(o.retries).toEqual([])
      expect(m2Steps(o)).toEqual(["unknown"])
      // The consumed settlement is the one that requested compaction; the cutoff still lost.
      const step = o.stored.parts.find((part) => part.type === "step-finish")
      if (step?.type !== "step-finish") throw new Error("M2 T02 missing settlement part")
      expect(step.tokens).toMatchObject({ total: 102 })
    }),
)

// M2-T03: EOF matrix. Every row has its own terminal and durable oracle.
const m2EofCases: {
  name: string
  events: LLMEvent[]
  settled: string | null
  result: "stop" | "continue"
  finish: string | undefined
  steps: string[]
  second?: boolean
}[] = [
  {
    name: "empty stream settles as unsettled step",
    events: [],
    settled: "unsettled-step",
    result: "stop",
    finish: "error",
    steps: [],
    second: true,
  },
  {
    name: "whitespace only output is not visible text",
    events: [
      g2Start(),
      LLMEvent.textStart({ id: "m2-ws" }),
      LLMEvent.textDelta({ id: "m2-ws", text: "   " }),
      LLMEvent.textEnd({ id: "m2-ws" }),
      g2Step("unknown"),
      g2Finish("unknown"),
    ],
    settled: "empty-unknown",
    result: "stop",
    finish: "error",
    steps: ["unknown"],
    second: true,
  },
  {
    name: "reasoning only unknown settles as empty unknown",
    events: [
      g2Start(),
      LLMEvent.reasoningStart({ id: "m2-reasoning" }),
      LLMEvent.reasoningDelta({ id: "m2-reasoning", text: "thinking" }),
      LLMEvent.reasoningEnd({ id: "m2-reasoning" }),
      g2Step("unknown"),
      g2Finish("unknown"),
    ],
    settled: "empty-unknown",
    result: "stop",
    finish: "error",
    steps: ["unknown"],
    second: true,
  },
  {
    name: "tool input only is not tool evidence",
    events: [
      g2Start(),
      LLMEvent.toolInputStart(g3Tool),
      LLMEvent.toolInputEnd(g3Tool),
      g2Step("unknown"),
      g2Finish("unknown"),
    ],
    settled: "empty-unknown",
    result: "stop",
    finish: "error",
    steps: ["unknown"],
  },
  {
    name: "usable text accepts unknown finish",
    events: [g2Start(), ...g2Text(), g2Step("unknown"), g2Finish("unknown")],
    settled: null,
    result: "continue",
    finish: "unknown",
    steps: ["unknown"],
  },
  {
    name: "usable tool call accepts unknown finish",
    events: [g2Start(), g3Call(), g2Step("unknown"), g2Finish("unknown")],
    settled: null,
    result: "continue",
    finish: "unknown",
    steps: ["unknown"],
  },
  {
    name: "valid empty stop is accepted",
    events: [g2Start(), g2Step("stop"), g2Finish("stop")],
    settled: null,
    result: "continue",
    finish: "stop",
    steps: ["stop"],
  },
]

for (const eof of m2EofCases) {
  m2Run(
    `session.processor M2 T03 ${eof.name}`,
    {
      attempts: eof.second
        ? [{ events: eof.events }, { events: [g2Start(), g2Step("stop"), g2Finish("stop")] }]
        : [{ events: eof.events }],
    },
    (o) =>
      Effect.gen(function* () {
        expect(Exit.isSuccess(o.exit)).toBe(true)
        if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
        if (eof.second) {
          expect(o.exit.value).toBe("continue")
          expect(o.invocations).toBe(2)
          expect(o.retries).toEqual([1])
          expect(o.handle.message.error).toBeUndefined()
          expect(o.stored.info.error).toBeUndefined()
          expect(o.errors).toEqual([])
          expect(o.handle.message.finish).toBe("stop")
          expect(o.stored.info.finish).toBe("stop")
          expect(m2Steps(o)).toEqual(["stop"])
          return
        }
        const result = o.exit.value
        if (eof.settled) {
          yield* m2Settled(o, eof.settled)
        } else {
          expect(o.handle.message.error).toBeUndefined()
          expect(o.stored.info.error).toBeUndefined()
          expect(o.errors).toEqual([])
        }
        expect(result).toBe(eof.result)
        expect(o.handle.message.finish).toBe(eof.finish)
        expect(o.stored.info.finish).toBe(eof.finish)
        expect(m2Steps(o)).toEqual(eof.steps)
        expect(o.invocations).toBe(1)
        expect(o.retries).toEqual([])
      }),
  )
}

// M2-T04: non-marker provider errors keep the legacy throw. The settlement that follows is
// never consumed, so the durable steps stay empty and no finish is written.
const m2NegativeCases: { name: string; marker: LLMEvent; message: string }[] = [
  {
    name: "unclassified provider error keeps legacy failure",
    marker: m2Unclassified(),
    message: "M2 unclassified provider failure",
  },
]

for (const negative of m2NegativeCases) {
  m2Run(
    `session.processor M2 T04 ${negative.name}`,
    { attempts: [{ events: [g2Start(), negative.marker, g2Step("unknown"), g2Finish("unknown")] }] },
    (o) =>
      Effect.gen(function* () {
        expect(Exit.isSuccess(o.exit)).toBe(true)
        if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
        const error = o.handle.message.error
        if (!error) throw new Error("M2 T04 expected the legacy parsed error")
        expect(error).toEqual({ name: "UnknownError", data: { message: negative.message } })
        expect(o.stored.info.error).toEqual(error)
        // No settlement ran and the stream failed, so no finish was ever written.
        expect(o.handle.message.finish).toBeUndefined()
        expect(o.stored.info.finish).toBeUndefined()
        // The events after the throw were never consumed.
        expect(m2Steps(o)).toEqual([])
        expect(o.exit.value).toBe("stop")
        expect(o.invocations).toBe(1)
        expect(o.retries).toEqual([])
        expect(o.errors).toEqual([{ sessionID: o.handle.message.sessionID, error }])
      }),
  )
}

m2Run(
  "session.processor M2 T04 context overflow classification still throws",
  {
    attempts: [
      {
        events: [
          g2Start(),
          LLMEvent.providerError({ message: "M2 context overflow", classification: "context-overflow" }),
          g2Step("unknown"),
          g2Finish("unknown"),
        ],
      },
    ],
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
      expect(o.exit.value).toBe("compact")
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.handle.message.finish).toBeUndefined()
      expect(o.stored.info.finish).toBeUndefined()
      expect(m2Steps(o)).toEqual([])
      expect(o.invocations).toBe(1)
      expect(o.retries).toEqual([])
      expect(o.errors).toEqual([
        {
          sessionID: o.handle.message.sessionID,
          error: { name: "ContextOverflowError", data: { message: "M2 context overflow" } },
        },
      ])
    }),
)

// M2-T05: strongest evidence-leak oracle. The attempt that saw the marker fails with a
// retryable error, so it must not settle, and the next attempt must not inherit its evidence.
m2Run(
  "session.processor M2 T05 marker evidence does not leak across attempts",
  {
    attempts: [
      { events: [g2Start(), m2Marker(), g2Step("unknown"), g2Finish("unknown")], retryable: true },
      { events: [g2Start(), g2Step("stop"), g2Finish("stop")] },
    ],
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
      expect(o.exit.value).toBe("continue")
      expect(o.invocations).toBe(2)
      expect(o.retries).toEqual([1])
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.errors).toEqual([])
      expect(o.handle.message.finish).toBe("stop")
      expect(o.stored.info.finish).toBe("stop")
      expect(m2Steps(o)).toEqual(["stop"])
    }),
)

// M2-T06: ordinary and blocked regressions against the changed result selection.
const m2OrdinaryAttempt = (n: number) => ({
  events: [
    g2Start(),
    LLMEvent.textStart({ id: `m2-t6-${n}` }),
    LLMEvent.textDelta({ id: `m2-t6-${n}`, text: `attempt ${n}` }),
    LLMEvent.textEnd({ id: `m2-t6-${n}` }),
  ],
  retryable: true,
})

// Five retryable attempts stay capped and keep their ordinal; the sixth is the recovery.
m2Run(
  "session.processor M2 T06 ordinary retries keep the five attempt cap and ordinal",
  {
    attempts: [
      ...Array.from({ length: 5 }, (_, index) => m2OrdinaryAttempt(index + 1)),
      { events: [g2Start(), g2Step("stop"), g2Finish("stop")] },
    ],
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
      expect(o.exit.value).toBe("continue")
      expect(o.invocations).toBe(6)
      expect(o.retries).toEqual([1, 2, 3, 4, 5])
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.errors).toEqual([])
      expect(m2Steps(o)).toEqual(["stop"])
      expect(o.stored.parts.some((part) => part.type === "text")).toBe(false)
    }),
)

// M4-T04: an incomplete attempt raises the control instead of settling, so its output is rolled
// back and the next attempt is the only one that survives. The control carries no interrupt
// reason, so the incomplete path must never publish an abort.
m2Run(
  "session.processor M4 T04 incomplete retry keeps only the final attempt output",
  {
    attempts: [
      {
        events: [
          g2Start(),
          LLMEvent.textStart({ id: "m4-t4-1" }),
          LLMEvent.textDelta({ id: "m4-t4-1", text: "m4 attempt 1" }),
          LLMEvent.textEnd({ id: "m4-t4-1" }),
        ],
      },
      {
        events: [
          g2Start(),
          LLMEvent.textStart({ id: "m4-t4-2" }),
          LLMEvent.textDelta({ id: "m4-t4-2", text: "m4 attempt 2" }),
          LLMEvent.textEnd({ id: "m4-t4-2" }),
          g2Step("stop"),
          g2Finish("stop"),
        ],
      },
    ],
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M4 failure Exit")
      expect(o.exit.value).toBe("continue")
      expect(o.invocations).toBe(2)
      expect(o.retries).toEqual([1])
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.errors).toEqual([])
      expect(o.handle.message.finish).toBe("stop")
      expect(o.stored.info.finish).toBe("stop")
      expect(m2Steps(o)).toEqual(["stop"])
      expect(o.stored.parts.some((part) => part.type === "text" && part.text === "m4 attempt 2")).toBe(true)
      expect(o.stored.parts.some((part) => part.type === "text" && part.text === "m4 attempt 1")).toBe(false)
      expect(o.status).toMatchObject({ type: "busy" })
    }),
)

// Control for the row below: this exact shape is what sets needsCompaction (cf. the G6
// compaction control), so a bare compaction request still returns compact.
m2Run(
  "session.processor M2 T06 compaction alone still returns compact",
  {
    attempts: [
      {
        events: [
          g2Start(),
          LLMEvent.textStart({ id: "m2-t6-compact" }),
          LLMEvent.textDelta({ id: "m2-t6-compact", text: "partial" }),
          LLMEvent.textEnd({ id: "m2-t6-compact" }),
          m2OverflowStep("unknown"),
          g2Finish("unknown"),
        ],
      },
    ],
    model: { context: 20, output: 10 },
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
      expect(o.exit.value).toBe("compact")
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.errors).toEqual([])
      expect(o.handle.message.finish).toBe("unknown")
      expect(m2Steps(o)).toEqual(["unknown"])
      expect(o.invocations).toBe(1)
      expect(o.retries).toEqual([])
    }),
)

// A rejected tool call blocks the turn; with compaction also requested the settled priority
// is stop, which only the result reorder can produce.
m2Run(
  "session.processor M2 T06 blocked plus compaction stops after the reorder",
  {
    attempts: [
      {
        events: [
          g2Start(),
          g3Call(),
          LLMEvent.toolResult({ ...g3Tool, result: { type: "error", value: new PermissionV1.RejectedError() } }),
          m2OverflowStep("unknown"),
          g2Finish("unknown"),
        ],
      },
    ],
    model: { context: 20, output: 10 },
  },
  (o) =>
    Effect.gen(function* () {
      expect(Exit.isSuccess(o.exit)).toBe(true)
      if (!Exit.isSuccess(o.exit)) throw new Error("unexpected M2 failure Exit")
      // A rejection blocks the turn but is not an assistant error, and no settlement ran.
      expect(o.exit.value).toBe("stop")
      expect(o.handle.message.error).toBeUndefined()
      expect(o.stored.info.error).toBeUndefined()
      expect(o.errors).toEqual([])
      expect(o.handle.message.finish).toBe("unknown")
      expect(m2Steps(o)).toEqual(["unknown"])
      const tool = o.stored.parts.find((part) => part.type === "tool" && part.callID === g3Tool.id)
      expect(tool).toMatchObject({ state: { status: "error" } })
      expect(o.invocations).toBe(1)
      expect(o.retries).toEqual([])
    }),
)

// ---------------------------------------------------------------------------
// M3: attempt rollback, deferred summary launch and secondary finalization Cause.
// ---------------------------------------------------------------------------

const m3Fail = () =>
  new APICallError({
    message: "M3 ordinary failure",
    url: "http://localhost/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 503,
    isRetryable: true,
  })

const m3Step = (scale: number) =>
  LLMEvent.stepFinish({
    index: 0,
    reason: "stop",
    usage: {
      inputTokens: 100 * scale,
      outputTokens: 50 * scale,
      reasoningTokens: 10 * scale,
      cacheReadInputTokens: 20 * scale,
      cacheWriteInputTokens: 10 * scale,
      totalTokens: 150 * scale,
    },
  })

const m3SettledStep = (): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.reasoningStart({ id: "m3-reasoning" }),
  LLMEvent.reasoningDelta({ id: "m3-reasoning", text: "M3 thinking" }),
  LLMEvent.textStart({ id: "m3-text" }),
  LLMEvent.textDelta({ id: "m3-text", text: "M3 partial" }),
  LLMEvent.reasoningEnd({ id: "m3-reasoning" }),
  LLMEvent.textEnd({ id: "m3-text" }),
  m3Step(1),
]

const m3Process = (parent: SessionV1.User, model: Provider.Model) => ({
  user: parent,
  sessionID: parent.sessionID,
  model,
  agent: agent(),
  system: [],
  messages: [{ role: "user" as const, content: "M3 rollback" }],
  tools: {},
})

const m3Boot = Effect.fn("test.m3Boot")(function* (dir: string) {
  const { processors, session, provider } = yield* boot()
  const bridge = yield* EventV2Bridge.Service
  const database = yield* Database.Service
  const chat = yield* session.create({})
  const parent = yield* user(chat.id, "M3 rollback")
  const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
  delete msg.finish
  yield* session.updateMessage(msg)
  const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
  const read = Effect.fn("test.m3Read")(function* (messageID: MessageID) {
    const view = yield* MessageV2.get({ sessionID: chat.id, messageID }).pipe(
      Effect.orDie,
      Effect.provideService(Database.Service, database),
    )
    if (view.info.role !== "assistant") return yield* Effect.die(new Error("M3 expected an assistant message"))
    return view as typeof view & { info: SessionV1.Assistant }
  })
  return { processors, session, bridge, database, chat, parent, msg, mdl, read }
})

const m3Tags = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.map((reason) => reason._tag) : ["success"]

const m3Listen = Effect.fn("test.m3Listen")(function* (chatID: SessionID, removed: PartID[]) {
  const bridge = yield* EventV2Bridge.Service
  const errors: string[] = []
  const retries: number[] = []
  const off = yield* bridge.listen((event) => {
    if (event.type === SessionStatus.Event.Status.type) {
      const data = event.data as typeof SessionStatus.Event.Status.data.Type
      if (data.sessionID === chatID && data.status.type === "retry") retries.push(data.status.attempt)
    }
    if (event.type === Session.Event.Error.type) {
      const data = event.data as typeof Session.Event.Error.data.Type
      if (data.sessionID === chatID && data.error) errors.push(data.error.name)
    }
    if (event.type === SessionV1.Event.PartRemoved.type) {
      const data = event.data as typeof SessionV1.Event.PartRemoved.data.Type
      if (data.sessionID === chatID) removed.push(data.partID)
    }
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)
  return { errors, retries }
})

// M3-T02 (a): the rollback completed before the backoff, then cancellation lands inside it. Cleanup
// must not rebuild the deleted parts from its transient references.
{
  let invocations = 0
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () =>
        Stream.suspend(() => {
          invocations++
          if (invocations > 1) return Stream.fail(new Error("M3-T02 unexpected extra invocation"))
          return Stream.concat(
            Stream.make(
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.textStart({ id: "m3t2-text" }),
              LLMEvent.textDelta({ id: "m3t2-text", text: "M3-T2 partial" }),
            ),
            Stream.fail(m3Fail()),
          )
        }),
    }),
  )
  const m3t2 = testEffect(LayerNode.compile(root, [...replacements, [LLM.node, source]]))
  m3t2.effect(
    "session.processor M3-T02 rollback before backoff interrupt does not resurrect deleted parts",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            invocations = 0
            const { processors, chat, parent, msg, mdl, read } = yield* m3Boot(dir)
            const baseline = yield* read(msg.id)
            const removed: PartID[] = []
            const { errors, retries } = yield* m3Listen(chat.id, removed)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const clock = yield* TestClock.testClockWith(Effect.succeed)
            const sleeping = yield* Deferred.make<number>()
            let cancelled = false
            const observedClock = {
              ...clock,
              sleep: (duration: Duration.Duration) =>
                Effect.gen(function* () {
                  // Park only the authorized backoff so cancellation lands inside it. Every other
                  // sleep (cleanup's tool wait) runs live so a frozen clock cannot hang the drain.
                  if (invocations !== 1 || cancelled) return yield* clock.withLive(Effect.sleep(duration))
                  const timer = yield* clock.sleep(duration).pipe(Effect.forkChild({ startImmediately: true }))
                  yield* Deferred.succeed(sleeping, Duration.toMillis(duration))
                  yield* Fiber.join(timer)
                }),
            } satisfies Clock.Clock
            const run = yield* handle
              .process(m3Process(parent, mdl))
              .pipe(Effect.provideService(Clock.Clock, observedClock), Effect.forkChild)
            // The parked sleep is the backoff itself, so the rollback has already completed.
            yield* clock.withLive(
              awaitWithTimeout(Deferred.await(sleeping), "M3-T02 backoff did not register", "5 seconds"),
            )
            cancelled = true
            run.interruptUnsafe()
            const exit = yield* clock.withLive(
              awaitWithTimeout(Fiber.await(run), "M3-T02 processor did not finish", "5 seconds"),
            )
            const stored = yield* read(msg.id)
            console.log(
              "M3-T02 observation",
              JSON.stringify({
                invocations,
                retries,
                errors,
                removed: removed.length,
                tags: m3Tags(exit),
              }),
            )
            // The attempt stays deleted; the abort is attributed by the processor's own
            // retry-region interrupt handler.
            expect(invocations).toBe(1)
            expect(retries).toEqual([1])
            expect(Exit.isFailure(exit)).toBe(true)
            if (!Exit.isFailure(exit)) throw new Error("M3-T02 expected an interrupt Exit")
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
            expect(errors).toEqual(["MessageAbortedError"])
            expect(handle.message.error).toEqual({ name: "MessageAbortedError", data: { message: "Aborted" } })
            expect(handle.message.finish).toBeUndefined()
            expect(handle.message.time.completed).toEqual(expect.any(Number))
            expect(stored.info).toEqual({
              ...baseline.info,
              error: { name: "MessageAbortedError", data: { message: "Aborted" } },
              time: { ...baseline.info.time, completed: handle.message.time.completed },
            })
            // Full payload equality: the open text part was not written back.
            expect(stored.parts).toEqual(baseline.parts)
            expect(stored.parts.some((part) => part.type === "tool")).toBe(false)
            expect(removed).toHaveLength(2)
            for (const partID of removed) expect(baseline.parts.some((part) => part.id === partID)).toBe(false)
          }),
        { config: cfg },
      ),
    30_000,
  )
}

// M3-T02 (b): cancellation in the middle of the rollback. The hook region is interruptible, so the
// deletion stops between two removals: neither the baseline restore nor the reference cleanup runs.
{
  let invocations = 0
  let removals: PartID[] = []
  let midRollback: Deferred.Deferred<void> | undefined
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () =>
        Stream.suspend(() => {
          invocations++
          if (invocations > 1) return Stream.fail(new Error("M3-T02 unexpected extra invocation"))
          return Stream.concat(Stream.fromIterable(m3SettledStep()), Stream.fail(m3Fail()))
        }),
    }),
  )
  const implementation = SessionProcessor.node.implementation
  if (!Layer.isLayer(implementation)) throw new Error("M3-T04 processor implementation is not a Layer")
  const processor = {
    ...SessionProcessor.node,
    implementation: Layer.updateService(implementation, Session.Service, (real) =>
      Session.Service.of({
        ...real,
        removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Effect.Effect<PartID> =>
          Effect.gen(function* () {
            const removed = yield* real.removePart(input)
            removals.push(input.partID)
            if (removals.length === 2) {
              // Cancel between two removals: the hook stops here without restoring or clearing.
              yield* Deferred.succeed(midRollback!, undefined)
              yield* Effect.never
            }
            return removed
          }),
      }),
    ),
  }
  const m3t2b = testEffect(
    LayerNode.compile(root, [...replacements, [LLM.node, source], [SessionProcessor.node, processor]]),
  )
  m3t2b.effect(
    "session.processor M3-T02 interrupt inside the rollback leaves a partial deletion",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            invocations = 0
            removals = []
            midRollback = yield* Deferred.make<void>()
            const { processors, session, chat, parent, msg, mdl, read } = yield* m3Boot(dir)
            msg.tokens = { total: 7, input: 7, output: 7, reasoning: 7, cache: { read: 7, write: 7 } }
            yield* session.updateMessage(msg)
            const removed: PartID[] = []
            const { errors, retries } = yield* m3Listen(chat.id, removed)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const clock = yield* TestClock.testClockWith(Effect.succeed)
            const run = yield* handle.process(m3Process(parent, mdl)).pipe(Effect.forkChild)
            yield* clock.withLive(
              awaitWithTimeout(Deferred.await(midRollback!), "M3-T02 rollback did not start", "5 seconds"),
            )
            // Durable view at the boundary: two parts deleted, the other two still owned.
            const boundary = yield* read(msg.id)
            run.interruptUnsafe()
            const exit = yield* clock.withLive(
              awaitWithTimeout(Fiber.await(run), "M3-T02 processor did not finish", "5 seconds"),
            )
            const stored = yield* read(msg.id)
            const kept = boundary.parts.map((part) => part.type)
            console.log(
              "M3-T02 boundary observation",
              JSON.stringify({
                invocations,
                retries,
                errors,
                removals: removals.length,
                removed: removed.length,
                kept,
                finish: stored.info.finish,
                tokens: stored.info.tokens,
                tags: m3Tags(exit),
              }),
            )
            expect(invocations).toBe(1)
            expect(Exit.isFailure(exit)).toBe(true)
            if (!Exit.isFailure(exit)) throw new Error("M3-T02 expected an interrupt Exit")
            expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
            expect(errors).toEqual(["MessageAbortedError"])
            expect(kept).toEqual(["text", "step-finish"])
            expect(removed).toEqual(removals)
            expect(removed).toHaveLength(2)
            for (const partID of removed) expect(boundary.parts.some((part) => part.id === partID)).toBe(false)
            // Cleanup still settles the message, but the interrupted rollback never restored it.
            expect(stored.parts).toEqual(boundary.parts)
            expect(stored.info.time.completed).toEqual(expect.any(Number))
            expect(stored.info.finish).toBe("stop")
            expect(stored.info.tokens).toEqual({
              total: 150,
              input: 70,
              output: 40,
              reasoning: 10,
              cache: { read: 20, write: 10 },
            })
            expect(retries).toEqual([])
          }),
        { config: cfg },
      ),
    30_000,
  )
}

// M3-T03: the deferred summary launch. Construction and execution are separate records, the
// discarded attempt reaches neither, and the retained launch is initiated by the finalizer before
// cleanup's first part write. Only initiation order is asserted, never body completion order.
{
  let invocations = 0
  let streamEnded = false
  let order = 0
  const constructed: { attempt: number; order: number; afterStream: boolean; messageID: MessageID }[] = []
  const executed: { attempt: number }[] = []
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () => {
        const attempt = ++invocations
        // Only writes after the FINAL stream's tail count as cleanup writes.
        streamEnded = false
        const textID = `m3t3-text-${attempt}`
        return Stream.concat(
          Stream.make(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: textID }),
            LLMEvent.textDelta({ id: textID, text: `M3-T3 ${attempt}` }),
            m3Step(attempt),
          ),
          Stream.suspend(() => {
            streamEnded = true
            return attempt === 1 ? Stream.fail(m3Fail()) : Stream.empty
          }),
        )
      },
    }),
  )
  const launched: ReturnType<typeof defer<void>>[] = []
  const summaries = Layer.succeed(
    SessionSummary.Service,
    SessionSummary.Service.of({
      summarize: (input) => {
        // Recorded at launch initiation; the body below records actual execution.
        const done = defer<void>()
        launched.push(done)
        constructed.push({
          attempt: invocations,
          order: ++order,
          afterStream: streamEnded,
          messageID: input.messageID,
        })
        return Effect.sync(() => {
          executed.push({ attempt: invocations })
          done.resolve()
        })
      },
      diff: () => Effect.succeed([]),
      computeDiff: () => Effect.succeed([]),
    }),
  )
  let partWrites: { order: number; afterStream: boolean }[] = []
  const implementation = SessionProcessor.node.implementation
  if (!Layer.isLayer(implementation)) throw new Error("M3-T03 processor implementation is not a Layer")
  const processor = {
    ...SessionProcessor.node,
    implementation: Layer.updateService(implementation, Session.Service, (real) =>
      Session.Service.of({
        ...real,
        updatePart: <T extends SessionV1.Part>(part: T): Effect.Effect<T> =>
          Effect.gen(function* () {
            partWrites.push({ order: ++order, afterStream: streamEnded })
            return yield* real.updatePart(part)
          }),
      }),
    ),
  }
  const m3t3 = testEffect(
    LayerNode.compile(root, [
      [SessionSummary.node, summaries],
      [
        RuntimeFlags.node,
        RuntimeFlags.layer({ experimentalEventSystem: true, disableDefaultPlugins: true, pure: true }),
      ],
      [LLM.node, source],
      [SessionProcessor.node, processor],
    ]),
  )
  m3t3.effect(
    "session.processor M3-T03 deferred summaries launch once at finalization before cleanup writes",
    () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            invocations = 0
            streamEnded = false
            order = 0
            constructed.length = 0
            executed.length = 0
            launched.length = 0
            partWrites = []
            const { processors, bridge, chat, parent, msg, mdl, read } = yield* m3Boot(dir)
            const baseline = yield* read(msg.id)
            let phase = "initial"
            let retry = 0
            const off = yield* bridge.listen((event) => {
              if (event.type === SessionStatus.Event.Status.type) {
                const data = event.data as typeof SessionStatus.Event.Status.data.Type
                if (data.sessionID === chat.id) {
                  phase = data.status.type
                  if (data.status.type === "retry") retry = data.status.attempt
                }
              }
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
            const { exit } = yield* g4Run(handle.process(m3Process(parent, mdl)), () => ({
              phase,
              attempt: retry,
              calls: invocations,
            }))
            expect(Exit.isSuccess(exit)).toBe(true)
            if (!Exit.isSuccess(exit)) throw new Error("M3-T03 unexpected failed Exit")
            const result = exit.value
            const clock = yield* TestClock.testClockWith(Effect.succeed)
            // Await the retained body only; the discarded attempt has nothing to wait for.
            yield* clock.withLive(
              awaitWithTimeout(
                Effect.forEach(launched, (done) => Effect.promise(() => done.promise)),
                "M3-T03 summary body did not execute",
                "5 seconds",
              ),
            )
            const stored = yield* read(msg.id)
            const cleanupWrites = partWrites.filter((write) => write.afterStream)
            console.log(
              "M3-T03 observation",
              JSON.stringify({
                invocations,
                constructed,
                executed,
                partWrites,
                cleanupWrites,
                result,
                retained: stored.parts.map((part) => part.type),
              }),
            )
            expect(result).toBe("continue")
            expect(invocations).toBe(2)
            // Both attempts requested a diff summary, but only the retained one is ever launched.
            expect(constructed).toEqual([
              { attempt: 2, order: expect.any(Number), afterStream: true, messageID: parent.id },
            ])
            expect(executed).toEqual([{ attempt: 2 }])
            // The launch is initiated after the stream ended and before cleanup's first part write.
            expect(cleanupWrites.length).toBeGreaterThan(0)
            expect(constructed[0]!.order).toBeLessThan(cleanupWrites[0]!.order)
            expect(stored.parts.map((part) => part.type)).toEqual([
              ...baseline.parts.map((part) => part.type),
              "step-start",
              "text",
              "step-finish",
            ])
          }),
        { config: cfg },
      ),
    30_000,
  )
}

// M3-T04: secondary Cause rows. A rollback defect escapes the retry without publishing a retry
// status; a cleanup fault is combined with it instead of replacing it; and a cleanup fault during an
// interrupted finalization reports the Die alone, without merging the pending interrupt.
const m3Defect = new Error("M3 rollback writer unavailable")
const m3Storage = new Error("M3 cleanup writer unavailable")
for (const scenario of ["rollback-die", "rollback-die-cleanup-fault", "cleanup-interrupt-fault"] as const) {
  let invocations = 0
  let armed = false
  let targetPart: PartID | undefined
  let flushing: Deferred.Deferred<void> | undefined
  let removals: PartID[] = []
  let inspect: Effect.Effect<{ info: SessionV1.Assistant; parts: SessionV1.Part[] }> = Effect.die(
    "M3-T04 snapshot service not initialized",
  )
  const source = Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: () =>
        Stream.suspend(() => {
          invocations++
          if (invocations > 1) return Stream.fail(new Error("M3-T04 unexpected extra invocation"))
          const cancels = scenario === "cleanup-interrupt-fault"
          return Stream.concat(
            // A settled step with no text-end leaves currentText open, so cleanup owns its flush.
            Stream.make(
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.textStart({ id: "m3t4-text" }),
              LLMEvent.textDelta({ id: "m3t4-text", text: "M3-T4 partial" }),
              m3Step(1),
            ),
            Stream.unwrap(
              Effect.gen(function* () {
                // Every head handler has returned: arm the cleanup write target from durable state.
                armed = true
                const before = yield* inspect
                targetPart = before.parts.find((part) => part.type === "text")?.id
                return cancels ? Stream.make(LLMEvent.finish({ reason: "stop" })) : Stream.fail(m3Fail())
              }),
            ),
          )
        }),
    }),
  )
  const implementation = SessionProcessor.node.implementation
  if (!Layer.isLayer(implementation)) throw new Error("M3-T04 processor implementation is not a Layer")
  const processor = {
    ...SessionProcessor.node,
    implementation: Layer.updateService(implementation, Session.Service, (real) =>
      Session.Service.of({
        ...real,
        removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }): Effect.Effect<PartID> =>
          Effect.gen(function* () {
            if (scenario !== "cleanup-interrupt-fault" && removals.length === 0) return yield* Effect.die(m3Defect)
            const removed = yield* real.removePart(input)
            removals.push(input.partID)
            return removed
          }),
        updatePart: <T extends SessionV1.Part>(part: T): Effect.Effect<T> =>
          Effect.gen(function* () {
            // Only the two fault scenarios block the cleanup write; `rollback-die` keeps cleanup
            // healthy so the row isolates "rollback defect escapes, cleanup still completed".
            if (scenario !== "rollback-die" && part.id === targetPart) {
              if (scenario === "cleanup-interrupt-fault") {
                // Park so the caller can cancel while finalization is uninterruptible.
                yield* Deferred.succeed(flushing!, undefined)
                yield* Effect.sleep("250 millis")
              }
              return yield* Effect.die(m3Storage)
            }
            return yield* real.updatePart(part)
          }),
      }),
    ),
  }
  const m3t4 = testEffect(
    LayerNode.compile(root, [...replacements, [LLM.node, source], [SessionProcessor.node, processor]]),
  )
  m3t4.live(`session.processor M3-T04 ${scenario}`, () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          invocations = 0
          targetPart = undefined
          removals = []
          flushing = yield* Deferred.make<void>()
          const { processors, chat, parent, msg, mdl, read } = yield* m3Boot(dir)
          inspect = read(msg.id)
          const baseline = yield* inspect
          const removed: PartID[] = []
          const { errors, retries } = yield* m3Listen(chat.id, removed)
          const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
          const run = yield* handle.process(m3Process(parent, mdl)).pipe(Effect.forkChild)
          if (scenario === "cleanup-interrupt-fault") {
            // Cancel while the finalizer holds its write, so an interrupt is pending on a successful
            // region exit plus a finalization fault.
            yield* awaitWithTimeout(Deferred.await(flushing!), "M3-T04 cleanup write did not start", "5 seconds")
            run.interruptUnsafe()
          }
          const exit = yield* awaitWithTimeout(Fiber.await(run), "M3-T04 processor did not finish", "5 seconds")
          const stored = yield* inspect
          const tags = m3Tags(exit)
          const hasDefect = (defect: unknown) =>
            Exit.isFailure(exit) &&
            exit.cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect === defect)
          const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)
          console.log(
            "M3-T04 observation",
            JSON.stringify({
              scenario,
              invocations,
              removals: removals.length,
              removed: removed.length,
              retries,
              errors,
              tags,
              hasRollbackDefect: hasDefect(m3Defect),
              hasStorageDefect: hasDefect(m3Storage),
              interrupted,
              completed: stored.info.time.completed ?? null,
            }),
          )
          expect(baseline.parts.some((part) => part.id === targetPart)).toBe(false)
          expect(invocations).toBe(1)
          expect(errors).toEqual([])
          expect(retries).toEqual([])
          expect(Exit.isFailure(exit)).toBe(true)
          if (!Exit.isFailure(exit)) throw new Error("M3-T04 expected a failure Exit")
          if (scenario === "rollback-die") {
            // The rollback defect is the whole cause: it escapes the retry and cleanup still runs to
            // its own successful completion.
            expect(removals).toEqual([])
            expect(tags).toEqual(["Die"])
            expect(hasDefect(m3Defect)).toBe(true)
            expect(hasDefect(m3Storage)).toBe(false)
            expect(interrupted).toBe(false)
            expect(stored.info.time.completed).toEqual(expect.any(Number))
            expect(stored.parts.find((part) => part.type === "text")).toMatchObject({ text: "M3-T4 partial" })
          }
          if (scenario === "rollback-die-cleanup-fault") {
            expect(removals).toEqual([])
            expect(tags).toEqual(["Die", "Die"])
            expect(hasDefect(m3Defect)).toBe(true)
            expect(hasDefect(m3Storage)).toBe(true)
            expect(interrupted).toBe(false)
            // The blocked cleanup write left the buffered delta undurable and the message unsettled.
            expect(stored.info.time.completed).toBeUndefined()
            expect(stored.parts.some((part) => part.type === "text" && part.text === "M3-T4 partial")).toBe(false)
          }
          if (scenario === "cleanup-interrupt-fault") {
            // Leftover subcase: the region exited successfully and the pending interrupt is not
            // merged into the finalization failure, so the Exit reports the Die alone.
            expect(removals).toEqual([])
            expect(tags).toEqual(["Die"])
            expect(hasDefect(m3Storage)).toBe(true)
            expect(interrupted).toBe(false)
            expect(stored.info.time.completed).toBeUndefined()
          }
        }),
      { config: cfg },
    ),
  )
}
