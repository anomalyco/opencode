import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, ServiceMap } from "effect"
import * as Stream from "effect/Stream"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
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
>()("@test/PromptLLM") {}

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

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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
const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps))
const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
const env = SessionPrompt.layer.pipe(Layer.provideMerge(compact), Layer.provideMerge(proc), Layer.provideMerge(deps))

const it = testEffect(env)

// Config that registers a custom "test" provider with a "test-model" model
// so Provider.getModel("test", "test-model") succeeds inside the loop.
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

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
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

const seed = Effect.fn("test.seed")(function* (sessionID: SessionID, opts?: { finish?: string }) {
  const session = yield* Session.Service
  const msg = yield* user(sessionID, "hello")
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: msg.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    ...(opts?.finish ? { finish: opts.finish } : {}),
  }
  yield* session.updateMessage(assistant)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "hi there",
  })
  return { user: msg, assistant }
})

// Priority 1: Loop lifecycle

it.effect("loop exits immediately when last assistant has stop finish", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({})
        yield* seed(chat.id, { finish: "stop" })

        const result = yield* prompt.loop({ sessionID: chat.id })
        expect(result.info.role).toBe("assistant")
        if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")
        expect(yield* test.calls).toBe(0)
      }),
    { git: true },
  ),
)

it.effect("loop calls LLM and returns assistant message", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        yield* test.reply(start(), textStart(), textDelta("t", "world"), textEnd(), finishStep(), finish())

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hello")

        const result = yield* prompt.loop({ sessionID: chat.id })
        expect(result.info.role).toBe("assistant")
        const parts = result.parts.filter((p) => p.type === "text")
        expect(parts.some((p) => p.type === "text" && p.text === "world")).toBe(true)
        expect(yield* test.calls).toBe(1)
      }),
    { git: true, config: cfg },
  ),
)

it.effect("loop continues when finish is tool-calls", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        // First reply finishes with tool-calls, second with stop
        yield* test.reply(
          start(),
          textStart(),
          textDelta("t", "first"),
          textEnd(),
          {
            type: "finish-step",
            finishReason: "tool-calls",
            rawFinishReason: "tool_calls",
            response: { id: "res", modelId: "test-model", timestamp: new Date() },
            providerMetadata: undefined,
            usage: usage(),
          },
          { type: "finish", finishReason: "tool-calls", rawFinishReason: "tool_calls", totalUsage: usage() },
        )
        yield* test.reply(start(), textStart(), textDelta("t", "second"), textEnd(), finishStep(), finish())

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hello")

        const result = yield* prompt.loop({ sessionID: chat.id })
        expect(yield* test.calls).toBe(2)
        expect(result.info.role).toBe("assistant")
      }),
    { git: true, config: cfg },
  ),
)

it.effect("loop sets status to busy then idle", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const bus = yield* Bus.Service

        yield* test.reply(start(), textStart(), textDelta("t", "ok"), textEnd(), finishStep(), finish())

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hi")

        const types: string[] = []
        const idle = defer<void>()
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          types.push(evt.properties.status.type)
          if (evt.properties.status.type === "idle") idle.resolve()
        })

        yield* prompt.loop({ sessionID: chat.id })
        yield* Effect.promise(() => idle.promise)
        off()

        expect(types).toContain("busy")
        expect(types[types.length - 1]).toBe("idle")
      }),
    { git: true, config: cfg },
  ),
)

// Priority 2: Cancel safety

it.effect("cancel interrupts loop and returns last assistant", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({})
        yield* seed(chat.id)

        // Make LLM hang so the loop blocks
        yield* test.push((input) => hang(input, start()))

        // Seed a new user message so the loop enters the LLM path
        yield* user(chat.id, "more")

        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        // Give the loop time to start
        yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 200)))
        yield* prompt.cancel(chat.id)

        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value.info.role).toBe("assistant")
        }
      }),
    { git: true, config: cfg },
  ),
  30_000,
)

it.effect("cancel records MessageAbortedError on interrupted process", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const ready = defer<void>()
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        yield* test.push((input) =>
          hang(input, start()).pipe(
            Stream.tap((event) => (event.type === "start" ? Effect.sync(() => ready.resolve()) : Effect.void)),
          ),
        )

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hello")

        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* Effect.promise(() => ready.promise)
        yield* prompt.cancel(chat.id)

        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          const info = exit.value.info
          if (info.role === "assistant") {
            expect(info.error?.name).toBe("MessageAbortedError")
          }
        }
      }),
    { git: true, config: cfg },
  ),
  30_000,
)

it.effect("cancel with queued callers resolves all cleanly", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const ready = defer<void>()
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        yield* test.push((input) =>
          hang(input, start()).pipe(
            Stream.tap((event) => (event.type === "start" ? Effect.sync(() => ready.resolve()) : Effect.void)),
          ),
        )

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hello")

        const a = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* Effect.promise(() => ready.promise)
        // Queue a second caller
        const b = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* Effect.promise(() => new Promise<void>((r) => setTimeout(r, 50)))

        yield* prompt.cancel(chat.id)

        const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
        // Both should resolve (success or interrupt, not error)
        expect(Exit.isFailure(exitA) && !Cause.hasInterruptsOnly(exitA.cause)).toBe(false)
        expect(Exit.isFailure(exitB) && !Cause.hasInterruptsOnly(exitB.cause)).toBe(false)
      }),
    { git: true, config: cfg },
  ),
  30_000,
)

// Priority 3: Deferred queue

it.effect("concurrent loop callers get same result", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({})
        yield* seed(chat.id, { finish: "stop" })

        const [a, b] = yield* Effect.all([prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })], {
          concurrency: "unbounded",
        })

        expect(a.info.id).toBe(b.info.id)
        expect(a.info.role).toBe("assistant")
      }),
    { git: true },
  ),
)

it.effect("concurrent loop callers all receive same error result", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        // Push a stream that fails — the loop records the error on the assistant message
        yield* test.push(Stream.fail(new Error("boom")))

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hello")

        const [a, b] = yield* Effect.all(
          [prompt.loop({ sessionID: chat.id }), prompt.loop({ sessionID: chat.id })],
          { concurrency: "unbounded" },
        )

        // Both callers get the same assistant with an error recorded
        expect(a.info.id).toBe(b.info.id)
        expect(a.info.role).toBe("assistant")
        if (a.info.role === "assistant") {
          expect(a.info.error).toBeDefined()
        }
      }),
    { git: true, config: cfg },
  ),
)

it.effect("assertNotBusy throws BusyError when loop running", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const ready = defer<void>()
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        yield* test.push((input) =>
          hang(input, start()).pipe(
            Stream.tap((event) => (event.type === "start" ? Effect.sync(() => ready.resolve()) : Effect.void)),
          ),
        )

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hi")

        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* Effect.promise(() => ready.promise)

        const exit = yield* prompt.assertNotBusy(chat.id).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)

        yield* prompt.cancel(chat.id)
        yield* Fiber.await(fiber)
      }),
    { git: true, config: cfg },
  ),
  30_000,
)

it.effect("assertNotBusy succeeds when idle", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({})
        const exit = yield* prompt.assertNotBusy(chat.id).pipe(Effect.exit)
        expect(Exit.isSuccess(exit)).toBe(true)
      }),
    { git: true },
  ),
)

// Priority 4: Shell basics

it.effect("shell rejects with BusyError when loop running", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const ready = defer<void>()
        const test = yield* TestLLM
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        yield* test.push((input) =>
          hang(input, start()).pipe(
            Stream.tap((event) => (event.type === "start" ? Effect.sync(() => ready.resolve()) : Effect.void)),
          ),
        )

        const chat = yield* sessions.create({})
        yield* user(chat.id, "hi")

        const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
        yield* Effect.promise(() => ready.promise)

        const exit = yield* prompt
          .shell({ sessionID: chat.id, agent: "build", command: "echo hi" })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)

        yield* prompt.cancel(chat.id)
        yield* Fiber.await(fiber)
      }),
    { git: true, config: cfg },
  ),
  30_000,
)
