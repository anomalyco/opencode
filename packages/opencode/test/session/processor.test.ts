import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { Effect, Layer, ManagedRuntime } from "effect"
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
import { MessageV2 } from "../../src/session/message-v2"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Snapshot } from "../../src/snapshot"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
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

async function user(sessionID: SessionID, text: string) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function assistant(sessionID: SessionID, parentID: MessageID, root: string) {
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
  await Session.updateMessage(msg)
  return msg
}

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fake() {
  const queue: Array<
    Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)
  > = []
  let calls = 0

  return {
    get calls() {
      return calls
    },
    push(stream: Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)) {
      queue.push(stream)
    },
    reply(...items: LLM.Event[]) {
      this.push(
        Stream.fromAsyncIterable(
          {
            async *[Symbol.asyncIterator]() {
              for (const item of items) yield item
            },
          },
          (err) => err,
        ),
      )
    },
    layer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          calls += 1
          const item = queue.shift() ?? Stream.empty
          const stream = typeof item === "function" ? item(input) : item
          return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
        },
      }),
    ),
  }
}

function runtime(layer: Layer.Layer<LLM.Service>) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus))
  return ManagedRuntime.make(
    Layer.mergeAll(SessionProcessor.layer, bus, status).pipe(
      Layer.provide(Session.defaultLayer),
      Layer.provide(Snapshot.defaultLayer),
      Layer.provide(AgentSvc.defaultLayer),
      Layer.provide(layer),
      Layer.provide(Permission.layer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(status),
      Layer.provide(bus),
      Layer.provide(Config.defaultLayer),
    ),
  )
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

describe("session.processor", () => {
  test("consumes text events from the injected stream", async () => {
    const stub = fake()
    stub.reply(
      { type: "start" } as LLM.Event,
      { type: "start-step" } as LLM.Event,
      { type: "text-start" } as LLM.Event,
      { type: "text-delta", text: "hello" } as LLM.Event,
      { type: "text-end" } as LLM.Event,
      {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      } as LLM.Event,
      { type: "finish" } as LLM.Event,
    )

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const root = path.resolve(tmp.path)
        const parent = await user(session.id, "hi")
        const msg = await assistant(session.id, parent.id, root)
        const abort = new AbortController()
        const rt = runtime(stub.layer)
        try {
          const mdl = model(100)
          const usr = {
            id: parent.id,
            sessionID: session.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User
          const info = agent()
          const hit = await rt.runPromise(
            SessionProcessor.Service.use((svc) =>
              svc.create({
                assistantMessage: msg,
                sessionID: session.id,
                model: mdl,
                abort: abort.signal,
              }),
            ),
          )

          const result = await Effect.runPromise(
            hit.process({
              user: usr,
              sessionID: session.id,
              model: mdl,
              agent: info,
              system: [],
              abort: abort.signal,
              messages: [{ role: "user", content: "hi" }],
              tools: {},
            }),
          )

          const parts = await MessageV2.parts(msg.id)
          expect(result).toBe("continue")
          expect(stub.calls).toBe(1)
          expect(parts.filter((part) => part.type === "text")).toHaveLength(1)
          expect(parts.some((part) => part.type === "text" && part.text === "hello")).toBe(true)
          expect(parts.some((part) => part.type === "step-finish")).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("stops after compaction is requested", async () => {
    const stub = fake()
    stub.reply(
      { type: "start" } as LLM.Event,
      {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      } as LLM.Event,
      { type: "text-start" } as LLM.Event,
      { type: "text-delta", text: "after" } as LLM.Event,
      { type: "text-end" } as LLM.Event,
    )

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const root = path.resolve(tmp.path)
        const parent = await user(session.id, "compact")
        const msg = await assistant(session.id, parent.id, root)
        const abort = new AbortController()
        const rt = runtime(stub.layer)
        try {
          const mdl = model(20)
          const usr = {
            id: parent.id,
            sessionID: session.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User
          const info = agent()
          const hit = await rt.runPromise(
            SessionProcessor.Service.use((svc) =>
              svc.create({
                assistantMessage: msg,
                sessionID: session.id,
                model: mdl,
                abort: abort.signal,
              }),
            ),
          )

          const result = await Effect.runPromise(
            hit.process({
              user: usr,
              sessionID: session.id,
              model: mdl,
              agent: info,
              system: [],
              abort: abort.signal,
              messages: [{ role: "user", content: "compact" }],
              tools: {},
            }),
          )

          const parts = await MessageV2.parts(msg.id)
          expect(result).toBe("compact")
          expect(parts.some((part) => part.type === "text")).toBe(false)
          expect(parts.some((part) => part.type === "step-finish")).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("records aborted runs as aborted errors and idles the session", async () => {
    const stub = fake()
    const ready = defer<void>()
    stub.push((input) =>
      Stream.fromAsyncIterable(
        {
          async *[Symbol.asyncIterator]() {
            yield { type: "start" } as LLM.Event
            ready.resolve()
            await new Promise<void>((done) => {
              input.abort.addEventListener("abort", () => done(), { once: true })
            })
            throw new DOMException("Aborted", "AbortError")
          },
        },
        (err) => err,
      ),
    )

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const root = path.resolve(tmp.path)
        const parent = await user(session.id, "abort")
        const msg = await assistant(session.id, parent.id, root)
        const abort = new AbortController()
        const rt = runtime(stub.layer)
        let off: (() => void) | undefined
        const errs: string[] = []
        try {
          const mdl = model(100)
          const usr = {
            id: parent.id,
            sessionID: session.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User
          const info = agent()
          off = await rt.runPromise(
            Bus.Service.use((svc) =>
              svc.subscribeCallback(Session.Event.Error, (evt) => {
                if (evt.properties.sessionID !== session.id) return
                if (evt.properties.error) errs.push(evt.properties.error.name)
              }),
            ),
          )
          const hit = await rt.runPromise(
            SessionProcessor.Service.use((svc) =>
              svc.create({
                assistantMessage: msg,
                sessionID: session.id,
                model: mdl,
                abort: abort.signal,
              }),
            ),
          )

          const run = Effect.runPromise(
            hit.process({
              user: usr,
              sessionID: session.id,
              model: mdl,
              agent: info,
              system: [],
              abort: abort.signal,
              messages: [{ role: "user", content: "abort" }],
              tools: {},
            }),
          )

          await ready.promise
          abort.abort()

          const result = await run
          const stored = await MessageV2.get({ sessionID: session.id, messageID: msg.id })
          const state = await rt.runPromise(SessionStatus.Service.use((svc) => svc.get(session.id)))

          expect(result).toBe("stop")
          expect(hit.message.error?.name).toBe("MessageAbortedError")
          expect(stored.info.role).toBe("assistant")
          if (stored.info.role === "assistant") {
            expect(stored.info.error?.name).toBe("MessageAbortedError")
          }
          expect(state).toMatchObject({ type: "idle" })
          expect(errs).toContain("MessageAbortedError")
        } finally {
          off?.()
          await rt.dispose()
        }
      },
    })
  })

  test("retries once and updates retry status", async () => {
    const stub = fake()
    const fail = () =>
      Stream.fromAsyncIterable(
        {
          async *[Symbol.asyncIterator]() {
            yield { type: "start" } as LLM.Event
            throw new APICallError({
              message: "boom",
              url: "https://example.com/v1/chat/completions",
              requestBodyValues: {},
              statusCode: 503,
              responseHeaders: { "retry-after-ms": "0" },
              responseBody: '{"error":"boom"}',
              isRetryable: true,
            })
          },
        },
        (err) => err,
      )
    const done = () =>
      Stream.fromAsyncIterable(
        {
          async *[Symbol.asyncIterator]() {
            yield { type: "start" } as LLM.Event
            yield {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            } as LLM.Event
            yield { type: "finish" } as LLM.Event
          },
        },
        (err) => err,
      )
    stub.push(fail())
    stub.push(done())

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const root = path.resolve(tmp.path)
        const parent = await user(session.id, "retry")
        const msg = await assistant(session.id, parent.id, root)
        const abort = new AbortController()
        const rt = runtime(stub.layer)
        let off: (() => void) | undefined
        const states: number[] = []
        try {
          const mdl = model(100)
          const usr = {
            id: parent.id,
            sessionID: session.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User
          const info = agent()
          off = await rt.runPromise(
            Bus.Service.use((svc) =>
              svc.subscribeCallback(SessionStatus.Event.Status, (evt) => {
                if (evt.properties.sessionID !== session.id) return
                if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
              }),
            ),
          )
          const hit = await rt.runPromise(
            SessionProcessor.Service.use((svc) =>
              svc.create({
                assistantMessage: msg,
                sessionID: session.id,
                model: mdl,
                abort: abort.signal,
              }),
            ),
          )

          const one = await Effect.runPromise(
            hit.process({
              user: usr,
              sessionID: session.id,
              model: mdl,
              agent: info,
              system: [],
              abort: abort.signal,
              messages: [{ role: "user", content: "retry" }],
              tools: {},
            }),
          )

          expect(one).toBe("continue")
          expect(stub.calls).toBe(2)
          expect(states).toStrictEqual([1])
        } finally {
          off?.()
          await rt.dispose()
        }
      },
    })
  })
})
