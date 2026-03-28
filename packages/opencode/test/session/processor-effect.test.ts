import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { APICallError } from "ai"
import { Effect, Layer, ServiceMap } from "effect"
import * as Stream from "effect/Stream"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Snapshot } from "../../src/snapshot"
import { Log } from "../../src/util/log"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

type Script = Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)

class TestLLM extends ServiceMap.Service<
  TestLLM,
  {
    readonly push: (stream: Script) => Effect.Effect<void>
    readonly reply: (...items: LLM.Event[]) => Effect.Effect<void>
    readonly calls: Effect.Effect<number>
    readonly inputs: Effect.Effect<LLM.StreamInput[]>
  }
>()("@test/SessionProcessorLLM") {}

function stream(...items: LLM.Event[]) {
  return Stream.make(...items)
}

function usage(input = 1, output = 1, total = input + output) {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
  }
}

function start(): LLM.Event {
  return { type: "start" }
}

function textStart(id = "t"): LLM.Event {
  return { type: "text-start", id }
}

function textDelta(id: string, text: string): LLM.Event {
  return { type: "text-delta", id, text }
}

function textEnd(id = "t"): LLM.Event {
  return { type: "text-end", id }
}

function reasoningStart(id: string): LLM.Event {
  return { type: "reasoning-start", id }
}

function reasoningDelta(id: string, text: string): LLM.Event {
  return { type: "reasoning-delta", id, text }
}

function reasoningEnd(id: string): LLM.Event {
  return { type: "reasoning-end", id }
}

function finishStep(): LLM.Event {
  return {
    type: "finish-step",
    finishReason: "stop",
    rawFinishReason: "stop",
    response: { id: "res", modelId: "test-model", timestamp: new Date() },
    providerMetadata: undefined,
    usage: usage(),
  }
}

function finish(): LLM.Event {
  return { type: "finish", finishReason: "stop", rawFinishReason: "stop", totalUsage: usage() }
}

function toolInputStart(id: string, toolName: string): LLM.Event {
  return { type: "tool-input-start", id, toolName }
}

function toolCall(toolCallId: string, toolName: string, input: unknown): LLM.Event {
  return { type: "tool-call", toolCallId, toolName, input }
}

function fail<E>(err: E, ...items: LLM.Event[]) {
  return stream(...items).pipe(Stream.concat(Stream.fail(err)))
}

function wait(abort: AbortSignal) {
  return Effect.promise(
    () =>
      new Promise<void>((done) => {
        abort.addEventListener("abort", () => done(), { once: true })
      }),
  )
}

function hang(input: LLM.StreamInput, ...items: LLM.Event[]) {
  return stream(...items).pipe(
    Stream.concat(
      Stream.unwrap(wait(input.abort).pipe(Effect.as(Stream.fail(new DOMException("Aborted", "AbortError"))))),
    ),
  )
}

function model(context: number): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context, output: 10 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
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
  const msg: MessageV2.Assistant = {
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

const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = []
    const inputs: LLM.StreamInput[] = []
    let calls = 0

    const push = Effect.fn("TestLLM.push")((item: Script) => {
      queue.push(item)
      return Effect.void
    })

    const reply = Effect.fn("TestLLM.reply")((...items: LLM.Event[]) => push(stream(...items)))
    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: (input) => {
            calls += 1
            inputs.push(input)
            const item = queue.shift() ?? Stream.empty
            return typeof item === "function" ? item(input) : item
          },
        }),
      ),
      Layer.succeed(
        TestLLM,
        TestLLM.of({
          push,
          reply,
          calls: Effect.sync(() => calls),
          inputs: Effect.sync(() => [...inputs]),
        }),
      ),
    )
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.layer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  status,
  llm,
).pipe(Layer.provideMerge(infra))
const env = SessionProcessor.layer.pipe(Layer.provideMerge(deps))

const it = testEffect(env)

it.effect("session.processor effect tests capture llm input cleanly", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service

        yield* test.reply(start(), textStart(), textDelta("t", "hello"), textEnd(), finishStep(), finish())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const input = {
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          abort: abort.signal,
          messages: [{ role: "user", content: "hi" }],
          tools: {},
        } satisfies LLM.StreamInput

        const value = yield* handle.process(input)
        const parts = yield* Effect.promise(() => MessageV2.parts(msg.id))
        const calls = yield* test.calls
        const inputs = yield* test.inputs

        expect(value).toBe("continue")
        expect(calls).toBe(1)
        expect(inputs).toHaveLength(1)
        expect(inputs[0].messages).toStrictEqual([{ role: "user", content: "hi" }])
        expect(parts.some((part) => part.type === "text" && part.text === "hello")).toBe(true)
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests stop after token overflow requests compaction", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service

        yield* test.reply(
          start(),
          {
            type: "finish-step",
            finishReason: "stop",
            rawFinishReason: "stop",
            response: { id: "res", modelId: "test-model", timestamp: new Date() },
            providerMetadata: undefined,
            usage: usage(100, 0, 100),
          },
          textStart(),
          textDelta("t", "after"),
          textEnd(),
        )

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(20)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          abort: abort.signal,
          messages: [{ role: "user", content: "compact" }],
          tools: {},
        })

        const parts = yield* Effect.promise(() => MessageV2.parts(msg.id))

        expect(value).toBe("compact")
        expect(parts.some((part) => part.type === "text")).toBe(false)
        expect(parts.some((part) => part.type === "step-finish")).toBe(true)
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests reset reasoning state across retries", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service

        yield* test.push(
          fail(
            new APICallError({
              message: "boom",
              url: "https://example.com/v1/chat/completions",
              requestBodyValues: {},
              statusCode: 503,
              responseHeaders: { "retry-after-ms": "0" },
              responseBody: '{"error":"boom"}',
              isRetryable: true,
            }),
            start(),
            reasoningStart("r"),
            reasoningDelta("r", "one"),
          ),
        )

        yield* test.reply(
          start(),
          reasoningStart("r"),
          reasoningDelta("r", "two"),
          reasoningEnd("r"),
          finishStep(),
          finish(),
        )

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "reason")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          abort: abort.signal,
          messages: [{ role: "user", content: "reason" }],
          tools: {},
        })

        const parts = yield* Effect.promise(() => MessageV2.parts(msg.id))
        const reasoning = parts.filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")

        expect(value).toBe("continue")
        expect(yield* test.calls).toBe(2)
        expect(reasoning.some((part) => part.text === "two")).toBe(true)
        expect(reasoning.some((part) => part.text === "onetwo")).toBe(false)
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests do not retry unknown json errors", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service

        yield* test.push(fail({ error: { message: "no_kv_space" } }, start()))

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          abort: abort.signal,
          messages: [{ role: "user", content: "json" }],
          tools: {},
        })

        expect(value).toBe("stop")
        expect(yield* test.calls).toBe(1)
        expect(yield* test.inputs).toHaveLength(1)
        expect(handle.message.error?.name).toBe("UnknownError")
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests retry recognized structured json errors", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service

        yield* test.push(fail({ type: "error", error: { type: "too_many_requests" } }, start()))
        yield* test.reply(start(), textStart(), textDelta("t", "after"), textEnd(), finishStep(), finish())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          abort: abort.signal,
          messages: [{ role: "user", content: "retry json" }],
          tools: {},
        })

        const parts = yield* Effect.promise(() => MessageV2.parts(msg.id))

        expect(value).toBe("continue")
        expect(yield* test.calls).toBe(2)
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests publish retry status updates", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service
        const bus = yield* Bus.Service

        yield* test.push(
          fail(
            new APICallError({
              message: "boom",
              url: "https://example.com/v1/chat/completions",
              requestBodyValues: {},
              statusCode: 503,
              responseHeaders: { "retry-after-ms": "0" },
              responseBody: '{"error":"boom"}',
              isRetryable: true,
            }),
            start(),
          ),
        )
        yield* test.reply(start(), finishStep(), finish())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const states: number[] = []
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          abort: abort.signal,
          messages: [{ role: "user", content: "retry" }],
          tools: {},
        })

        off()

        expect(value).toBe("continue")
        expect(yield* test.calls).toBe(2)
        expect(states).toStrictEqual([1])
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests compact on structured context overflow", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service

        yield* test.push(fail({ type: "error", error: { code: "context_length_exceeded" } }, start()))

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          abort: abort.signal,
          messages: [{ role: "user", content: "compact json" }],
          tools: {},
        })

        expect(value).toBe("compact")
        expect(yield* test.calls).toBe(1)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests mark pending tools as aborted on cleanup", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const ready = defer<void>()
        const seen = defer<void>()
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service

        yield* test.push((input) =>
          hang(input, start(), toolInputStart("tool-1", "bash"), toolCall("tool-1", "bash", { cmd: "pwd" })).pipe(
            Stream.tap((event) => (event.type === "tool-call" ? Effect.sync(() => ready.resolve()) : Effect.void)),
          ),
        )

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "tool abort")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const run = Effect.runPromise(
          handle.process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            abort: abort.signal,
            messages: [{ role: "user", content: "tool abort" }],
            tools: {},
          }),
        )

        yield* Effect.promise(() => ready.promise)
        abort.abort()

        const value = yield* Effect.promise(() => run)
        const parts = yield* Effect.promise(() => MessageV2.parts(msg.id))
        const tool = parts.find((part): part is MessageV2.ToolPart => part.type === "tool")

        expect(value).toBe("stop")
        expect(yield* test.calls).toBe(1)
        expect(tool?.state.status).toBe("error")
        if (tool?.state.status === "error") {
          expect(tool.state.error).toBe("Tool execution aborted")
          expect(tool.state.time.end).toBeDefined()
        }
      }),
    { git: true },
  )
})

it.effect("session.processor effect tests record aborted errors and idle state", () => {
  return provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const ready = defer<void>()
        const seen = defer<void>()
        const test = yield* TestLLM
        const processors = yield* SessionProcessor.Service
        const session = yield* Session.Service
        const bus = yield* Bus.Service
        const status = yield* SessionStatus.Service

        yield* test.push((input) =>
          hang(input, start()).pipe(
            Stream.tap((event) => (event.type === "start" ? Effect.sync(() => ready.resolve()) : Effect.void)),
          ),
        )

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "abort")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const abort = new AbortController()
        const mdl = model(100)
        const errs: string[] = []
        const off = yield* bus.subscribeCallback(Session.Event.Error, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (!evt.properties.error) return
          errs.push(evt.properties.error.name)
          seen.resolve()
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
          abort: abort.signal,
        })

        const run = Effect.runPromise(
          handle.process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            abort: abort.signal,
            messages: [{ role: "user", content: "abort" }],
            tools: {},
          }),
        )

        yield* Effect.promise(() => ready.promise)
        abort.abort()

        const value = yield* Effect.promise(() => run)
        yield* Effect.promise(() => seen.promise)
        const stored = yield* Effect.promise(() => MessageV2.get({ sessionID: chat.id, messageID: msg.id }))
        const state = yield* status.get(chat.id)
        off()

        expect(value).toBe("stop")
        expect(handle.message.error?.name).toBe("MessageAbortedError")
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.error?.name).toBe("MessageAbortedError")
        }
        expect(state).toMatchObject({ type: "idle" })
        expect(errs).toContain("MessageAbortedError")
      }),
    { git: true },
  )
})
