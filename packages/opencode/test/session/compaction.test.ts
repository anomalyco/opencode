import { afterEach, describe, expect, mock, test } from "bun:test"
import { APICallError } from "ai"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import * as Stream from "effect/Stream"
import z from "zod"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config"
import { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { SessionCompaction } from "../../src/session/compaction"
import { Token } from "../../src/util"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider"
import * as SessionProcessorModule from "../../src/session/processor"
import { Snapshot } from "../../src/snapshot"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  messages(input: z.output<typeof SessionNs.MessagesInput>) {
    return run(SessionNs.Service.use((svc) => svc.messages(input)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((svc) => svc.updatePart(part)))
  },
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

afterEach(() => {
  mock.restore()
})

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const wide = () => ProviderTest.fake({ model: createModel({ context: 100_000, output: 32_000 }) })

async function user(sessionID: SessionID, text: string) {
  const msg = await svc.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  await svc.updatePart({
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
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  await svc.updateMessage(msg)
  return msg
}

function fake(
  input: Parameters<SessionProcessorModule.SessionProcessor.Interface["create"]>[0],
  result: "continue" | "compact",
) {
  const msg = input.assistantMessage
  return {
    get message() {
      return msg
    },
    updateToolCall: Effect.fn("TestSessionProcessor.updateToolCall")(() => Effect.succeed(undefined)),
    completeToolCall: Effect.fn("TestSessionProcessor.completeToolCall")(() => Effect.void),
    process: Effect.fn("TestSessionProcessor.process")(() => Effect.succeed(result)),
  } satisfies SessionProcessorModule.SessionProcessor.Handle
}

function layer(result: "continue" | "compact") {
  return Layer.succeed(
    SessionProcessorModule.SessionProcessor.Service,
    SessionProcessorModule.SessionProcessor.Service.of({
      create: Effect.fn("TestSessionProcessor.create")((input) => Effect.succeed(fake(input, result))),
    }),
  )
}

function cfg(compaction?: Config.Info["compaction"]) {
  const base = Config.Info.zod.parse({})
  return Layer.mock(Config.Service)({
    get: () => Effect.succeed({ ...base, compaction }),
  })
}

function runtime(
  result: "continue" | "compact",
  plugin = Plugin.defaultLayer,
  provider = ProviderTest.fake(),
  config = Config.defaultLayer,
) {
  const bus = Bus.layer
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer, bus).pipe(
      Layer.provide(provider.layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(layer(result)),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(plugin),
      Layer.provide(bus),
      Layer.provide(config),
    ),
  )
}

const deps = Layer.mergeAll(
  ProviderTest.fake().layer,
  layer("continue"),
  Agent.defaultLayer,
  Plugin.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
)

const env = Layer.mergeAll(
  SessionNs.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionCompaction.layer.pipe(Layer.provide(SessionNs.defaultLayer), Layer.provideMerge(deps)),
)

const it = testEffect(env)

function llm() {
  const queue: Array<
    Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)
  > = []

  return {
    push(stream: Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)) {
      queue.push(stream)
    },
    layer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          const item = queue.shift() ?? Stream.empty
          const stream = typeof item === "function" ? item(input) : item
          return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
        },
      }),
    ),
  }
}

function liveRuntime(layer: Layer.Layer<LLM.Service>, provider = ProviderTest.fake(), config = Config.defaultLayer) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus))
  const processor = SessionProcessorModule.SessionProcessor.layer.pipe(Layer.provide(summary))
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer.pipe(Layer.provide(processor)), processor, bus, status).pipe(
      Layer.provide(provider.layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(Snapshot.defaultLayer),
      Layer.provide(layer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(status),
      Layer.provide(bus),
      Layer.provide(config),
    ),
  )
}

function reply(
  text: string,
  capture?: (input: LLM.StreamInput) => void,
): (input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown> {
  return (input) => {
    capture?.(input)
    return Stream.make(
      { type: "start" } satisfies LLM.Event,
      { type: "text-start", id: "txt-0" } satisfies LLM.Event,
      { type: "text-delta", id: "txt-0", delta: text, text } as LLM.Event,
      { type: "text-end", id: "txt-0" } satisfies LLM.Event,
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "stop",
        response: { id: "res", modelId: "test-model", timestamp: new Date() },
        providerMetadata: undefined,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
      } satisfies LLM.Event,
      {
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
      } satisfies LLM.Event,
    )
  }
}

function wait(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defer() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function plugin(ready: ReturnType<typeof defer>) {
  return Layer.mock(Plugin.Service)({
    trigger: <Name extends string, Input, Output>(name: Name, _input: Input, output: Output) => {
      if (name !== "experimental.session.compacting") return Effect.succeed(output)
      return Effect.sync(() => ready.resolve()).pipe(Effect.andThen(Effect.never), Effect.as(output))
    },
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  })
}

function autocontinue(enabled: boolean) {
  return Layer.mock(Plugin.Service)({
    trigger: <Name extends string, Input, Output>(name: Name, _input: Input, output: Output) => {
      if (name !== "experimental.compaction.autocontinue") return Effect.succeed(output)
      return Effect.sync(() => {
        ;(output as { enabled: boolean }).enabled = enabled
        return output
      })
    },
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  })
}

describe("session.compaction.isOverflow", () => {
  it.live(
    "returns true when token count exceeds usable context",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "returns false when token count within usable context",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "includes cache.read in token count",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 60_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "respects input limit for input caps",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 271_000, output: 1_000, reasoning: 0, cache: { read: 2_000, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "returns false when input/output are within input caps",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 200_000, output: 20_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "returns false when output within limit with input caps",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 200_000, input: 120_000, output: 10_000 })
        const tokens = { input: 50_000, output: 9_999, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  // ─── Bug reproduction tests ───────────────────────────────────────────
  // These tests demonstrate that when limit.input is set, isOverflow()
  // does not subtract any headroom for the next model response. This means
  // compaction only triggers AFTER we've already consumed the full input
  // budget, leaving zero room for the next API call's output tokens.
  //
  // Compare: without limit.input, usable = context - output (reserves space).
  // With limit.input, usable = limit.input (reserves nothing).
  //
  // Related issues: #10634, #8089, #11086, #12621
  // Open PRs: #6875, #12924

  it.live(
    "BUG: no headroom when limit.input is set — compaction should trigger near boundary but does not",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        // Simulate Claude with prompt caching: input limit = 200K, output limit = 32K
        const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })

        // We've used 198K tokens total. Only 2K under the input limit.
        // On the next turn, the full conversation (198K) becomes input,
        // plus the model needs room to generate output — this WILL overflow.
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
        // count = 180K + 3K + 15K = 198K
        // usable = limit.input = 200K (no output subtracted!)
        // 198K > 200K = false → no compaction triggered

        // WITHOUT limit.input: usable = 200K - 32K = 168K, and 198K > 168K = true ✓
        // WITH limit.input: usable = 200K, and 198K > 200K = false ✗

        // With 198K used and only 2K headroom, the next turn will overflow.
        // Compaction MUST trigger here.
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "BUG: without limit.input, same token count correctly triggers compaction",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        // Same model but without limit.input — uses context - output instead
        const model = createModel({ context: 200_000, output: 32_000 })

        // Same token usage as above
        const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
        // count = 198K
        // usable = context - output = 200K - 32K = 168K
        // 198K > 168K = true → compaction correctly triggered

        const result = yield* compact.isOverflow({ tokens, model })
        expect(result).toBe(true) // ← Correct: headroom is reserved
      }),
    ),
  )

  it.live(
    "BUG: asymmetry — limit.input model allows 30K more usage before compaction than equivalent model without it",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        // Two models with identical context/output limits, differing only in limit.input
        const withInputLimit = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const withoutInputLimit = createModel({ context: 200_000, output: 32_000 })

        // 170K total tokens — well above context-output (168K) but below input limit (200K)
        const tokens = { input: 166_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }

        const withLimit = yield* compact.isOverflow({ tokens, model: withInputLimit })
        const withoutLimit = yield* compact.isOverflow({ tokens, model: withoutInputLimit })

        // Both models have identical real capacity — they should agree:
        expect(withLimit).toBe(true) // should compact (170K leaves no room for 32K output)
        expect(withoutLimit).toBe(true) // correctly compacts (170K > 168K)
      }),
    ),
  )

  it.live(
    "returns false when model context limit is 0",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 0, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "returns false when compaction.auto is disabled",
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const model = createModel({ context: 100_000, output: 32_000 })
          const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
          expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
        }),
      {
        config: {
          compaction: { auto: false },
        },
      },
    ),
  )
})

describe("session.compaction.create", () => {
  it.live(
    "creates a compaction user message and part",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service

        const info = yield* ssn.create({})

        yield* compact.create({
          sessionID: info.id,
          agent: "build",
          model: ref,
          auto: true,
          overflow: true,
        })

        const msgs = yield* ssn.messages({ sessionID: info.id })
        expect(msgs).toHaveLength(1)
        expect(msgs[0].info.role).toBe("user")
        expect(msgs[0].parts).toHaveLength(1)
        expect(msgs[0].parts[0]).toMatchObject({
          type: "compaction",
          auto: true,
          overflow: true,
        })
      }),
    ),
  )
})

describe("session.compaction.prune", () => {
  it.live(
    "compacts old completed tool output",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const info = yield* ssn.create({})
          const a = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "build",
            model: ref,
            time: { created: Date.now() },
          })
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: a.id,
            sessionID: info.id,
            type: "text",
            text: "first",
          })
          const b: MessageV2.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: info.id,
            mode: "build",
            agent: "build",
            path: { cwd: dir, root: dir },
            cost: 0,
            tokens: {
              output: 0,
              input: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: ref.modelID,
            providerID: ref.providerID,
            parentID: a.id,
            time: { created: Date.now() },
            finish: "end_turn",
          }
          yield* ssn.updateMessage(b)
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: b.id,
            sessionID: info.id,
            type: "tool",
            callID: crypto.randomUUID(),
            tool: "bash",
            state: {
              status: "completed",
              input: {},
              output: "x".repeat(200_000),
              title: "done",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          })
          for (const text of ["second", "third"]) {
            const msg = yield* ssn.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: info.id,
              agent: "build",
              model: ref,
              time: { created: Date.now() },
            })
            yield* ssn.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: info.id,
              type: "text",
              text,
            })
          }

          yield* compact.prune({ sessionID: info.id })

          const msgs = yield* ssn.messages({ sessionID: info.id })
          const part = msgs.flatMap((msg) => msg.parts).find((part) => part.type === "tool")
          expect(part?.type).toBe("tool")
          expect(part?.state.status).toBe("completed")
          if (part?.type === "tool" && part.state.status === "completed") {
            expect(part.state.time.compacted).toBeNumber()
          }
        }),

      {
        config: {
          compaction: { prune: true },
        },
      },
    ),
  )

  it.live(
    "skips protected skill tool output",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const a = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: a.id,
          sessionID: info.id,
          type: "text",
          text: "first",
        })
        const b: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: a.id,
          time: { created: Date.now() },
          finish: "end_turn",
        }
        yield* ssn.updateMessage(b)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: b.id,
          sessionID: info.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "skill",
          state: {
            status: "completed",
            input: {},
            output: "x".repeat(200_000),
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        for (const text of ["second", "third"]) {
          const msg = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "build",
            model: ref,
            time: { created: Date.now() },
          })
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: info.id,
            type: "text",
            text,
          })
        }

        yield* compact.prune({ sessionID: info.id })

        const msgs = yield* ssn.messages({ sessionID: info.id })
        const part = msgs.flatMap((msg) => msg.parts).find((part) => part.type === "tool")
        expect(part?.type).toBe("tool")
        if (part?.type === "tool" && part.state.status === "completed") {
          expect(part.state.time.compacted).toBeUndefined()
        }
      }),
    ),
  )
})

describe("session.compaction.process", () => {
  test("throws when parent is not a user message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const reply = await assistant(session.id, msg.id, tmp.path)
        const rt = runtime("continue")
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          await expect(
            rt.runPromise(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: reply.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: false,
                }),
              ),
            ),
          ).rejects.toThrow(`Compaction parent must be a user message: ${reply.id}`)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("publishes compacted event on continue", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const msgs = await svc.messages({ sessionID: session.id })
        const done = defer()
        let seen = false
        const rt = runtime("continue", Plugin.defaultLayer, wide())
        let unsub: (() => void) | undefined
        try {
          unsub = await rt.runPromise(
            Bus.Service.use((svc) =>
              svc.subscribeCallback(SessionCompaction.Event.Compacted, (evt) => {
                if (evt.properties.sessionID !== session.id) return
                seen = true
                done.resolve()
              }),
            ),
          )

          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          await Promise.race([
            done.promise,
            wait(500).then(() => {
              throw new Error("timed out waiting for compacted event")
            }),
          ])
          expect(result).toBe("continue")
          expect(seen).toBe(true)
        } finally {
          unsub?.()
          await rt.dispose()
        }
      },
    })
  })

  test("marks summary message as errored on compact result", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const rt = runtime("compact", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )

          expect(result).toBe("stop")
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") {
            expect(summary.info.finish).toBe("error")
            expect(JSON.stringify(summary.info.error)).toContain("Session too large to compact")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("adds synthetic continue prompt when auto is enabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const last = all.at(-1)

          expect(result).toBe("continue")
          expect(last?.info.role).toBe("user")
          expect(last?.parts[0]).toMatchObject({
            type: "text",
            synthetic: true,
            metadata: { compaction_continue: true },
          })
          if (last?.parts[0]?.type === "text") {
            expect(last.parts[0].text).toContain("Continue if you have next steps")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("persists tail_start_id for retained recent turns", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "first")
        const keep = await user(session.id, "second")
        await user(session.id, "third")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = runtime(
          "continue",
          Plugin.defaultLayer,
          wide(),
          cfg({ tail_turns: 2, preserve_recent_tokens: 10_000 }),
        )
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = (await svc.messages({ sessionID: session.id }))
            .at(-2)
            ?.parts.find((item) => item.type === "compaction")

          expect(part?.type).toBe("compaction")
          if (part?.type === "compaction") expect(part.tail_start_id).toBe(keep.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("shrinks retained tail to fit preserve token budget", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "first")
        await user(session.id, "x".repeat(2_000))
        const keep = await user(session.id, "tiny")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = runtime("continue", Plugin.defaultLayer, wide(), cfg({ tail_turns: 2, preserve_recent_tokens: 100 }))
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = (await svc.messages({ sessionID: session.id }))
            .at(-2)
            ?.parts.find((item) => item.type === "compaction")

          expect(part?.type).toBe("compaction")
          if (part?.type === "compaction") expect(part.tail_start_id).toBe(keep.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("falls back to full summary when even one recent turn exceeds preserve token budget", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "first")
        await user(session.id, "y".repeat(2_000))
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg({ tail_turns: 1, preserve_recent_tokens: 20 }))
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = (await svc.messages({ sessionID: session.id }))
            .at(-2)
            ?.parts.find((item) => item.type === "compaction")

          expect(part?.type).toBe("compaction")
          if (part?.type === "compaction") expect(part.tail_start_id).toBeUndefined()
          expect(captured).toContain("yyyy")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("falls back to full summary when retained tail media exceeds preserve token budget", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "older")
        const recent = await user(session.id, "recent image turn")
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: recent.id,
          sessionID: session.id,
          type: "file",
          mime: "image/png",
          filename: "big.png",
          url: `data:image/png;base64,${"a".repeat(4_000)}`,
        })
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg({ tail_turns: 1, preserve_recent_tokens: 100 }))
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = (await svc.messages({ sessionID: session.id }))
            .at(-2)
            ?.parts.find((item) => item.type === "compaction")

          expect(part?.type).toBe("compaction")
          if (part?.type === "compaction") expect(part.tail_start_id).toBeUndefined()
          expect(captured).toContain("recent image turn")
          expect(captured).toContain("Attached image/png: big.png")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("allows plugins to disable synthetic continue prompt", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const rt = runtime("continue", autocontinue(false), wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const last = all.at(-1)

          expect(result).toBe("continue")
          expect(last?.info.role).toBe("assistant")
          expect(
            all.some(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some(
                  (part) =>
                    part.type === "text" && part.synthetic && part.text.includes("Continue if you have next steps"),
                ),
            ),
          ).toBe(false)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("replays the prior user turn on overflow when earlier context exists", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "root")
        const replay = await user(session.id, "image")
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: replay.id,
          sessionID: session.id,
          type: "file",
          mime: "image/png",
          filename: "cat.png",
          url: "https://example.com/cat.png",
        })
        const msg = await user(session.id, "current")
        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                overflow: true,
              }),
            ),
          )

          const last = (await svc.messages({ sessionID: session.id })).at(-1)

          expect(result).toBe("continue")
          expect(last?.info.role).toBe("user")
          expect(last?.parts.some((part) => part.type === "file")).toBe(false)
          expect(
            last?.parts.some((part) => part.type === "text" && part.text.includes("Attached image/png: cat.png")),
          ).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("falls back to overflow guidance when no replayable turn exists", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "earlier")
        const msg = await user(session.id, "current")

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                overflow: true,
              }),
            ),
          )

          const last = (await svc.messages({ sessionID: session.id })).at(-1)

          expect(result).toBe("continue")
          expect(last?.info.role).toBe("user")
          if (last?.parts[0]?.type === "text") {
            expect(last.parts[0].text).toContain("previous request exceeded the provider's size limit")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("stops quickly when aborted during retry backoff", async () => {
    const stub = llm()
    const ready = defer()
    stub.push(
      Stream.fromAsyncIterable(
        {
          async *[Symbol.asyncIterator]() {
            yield { type: "start" } as LLM.Event
            throw new APICallError({
              message: "boom",
              url: "https://example.com/v1/chat/completions",
              requestBodyValues: {},
              statusCode: 503,
              responseHeaders: { "retry-after-ms": "10000" },
              responseBody: '{"error":"boom"}',
              isRetryable: true,
            })
          },
        },
        (err) => err,
      ),
    )

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const msgs = await svc.messages({ sessionID: session.id })
        const abort = new AbortController()
        const rt = liveRuntime(stub.layer, wide())
        let off: (() => void) | undefined
        let run: Promise<"continue" | "stop"> | undefined
        try {
          off = await rt.runPromise(
            Bus.Service.use((svc) =>
              svc.subscribeCallback(SessionStatus.Event.Status, (evt) => {
                if (evt.properties.sessionID !== session.id) return
                if (evt.properties.status.type !== "retry") return
                ready.resolve()
              }),
            ),
          )

          run = rt
            .runPromiseExit(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: msg.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: false,
                }),
              ),
              { signal: abort.signal },
            )
            .then((exit) => {
              if (Exit.isFailure(exit)) {
                if (Cause.hasInterrupts(exit.cause) && abort.signal.aborted) return "stop"
                throw Cause.squash(exit.cause)
              }
              return exit.value
            })

          await Promise.race([
            ready.promise,
            wait(1000).then(() => {
              throw new Error("timed out waiting for retry status")
            }),
          ])

          const start = Date.now()
          abort.abort()
          const result = await Promise.race([
            run.then((value) => ({ kind: "done" as const, value, ms: Date.now() - start })),
            wait(250).then(() => ({ kind: "timeout" as const })),
          ])

          expect(result.kind).toBe("done")
          if (result.kind === "done") {
            expect(result.value).toBe("stop")
            expect(result.ms).toBeLessThan(250)
          }
        } finally {
          off?.()
          abort.abort()
          await rt.dispose()
          await run?.catch(() => undefined)
        }
      },
    })
  })

  test("does not leave a summary assistant when aborted before processor setup", async () => {
    const ready = defer()

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const msgs = await svc.messages({ sessionID: session.id })
        const abort = new AbortController()
        const rt = runtime("continue", plugin(ready), wide())
        let run: Promise<"continue" | "stop"> | undefined
        try {
          run = rt
            .runPromiseExit(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: msg.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: false,
                }),
              ),
              { signal: abort.signal },
            )
            .then((exit) => {
              if (Exit.isFailure(exit)) {
                if (Cause.hasInterrupts(exit.cause) && abort.signal.aborted) return "stop"
                throw Cause.squash(exit.cause)
              }
              return exit.value
            })

          await Promise.race([
            ready.promise,
            wait(1000).then(() => {
              throw new Error("timed out waiting for compaction hook")
            }),
          ])

          abort.abort()
          expect(await run).toBe("stop")

          const all = await svc.messages({ sessionID: session.id })
          expect(all.some((msg) => msg.info.role === "assistant" && msg.info.summary)).toBe(false)
        } finally {
          abort.abort()
          await rt.dispose()
          await run?.catch(() => undefined)
        }
      },
    })
  })

  test("does not allow tool calls while generating the summary", async () => {
    const stub = llm()
    stub.push(
      Stream.make(
        { type: "start" } satisfies LLM.Event,
        { type: "tool-input-start", id: "call-1", toolName: "_noop" } satisfies LLM.Event,
        { type: "tool-call", toolCallId: "call-1", toolName: "_noop", input: {} } satisfies LLM.Event,
        {
          type: "finish-step",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          response: { id: "res", modelId: "test-model", timestamp: new Date() },
          providerMetadata: undefined,
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            inputTokenDetails: {
              noCacheTokens: undefined,
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
            },
            outputTokenDetails: {
              textTokens: undefined,
              reasoningTokens: undefined,
            },
          },
        } satisfies LLM.Event,
        {
          type: "finish",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          totalUsage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            inputTokenDetails: {
              noCacheTokens: undefined,
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
            },
            outputTokenDetails: {
              textTokens: undefined,
              reasoningTokens: undefined,
            },
          },
        } satisfies LLM.Event,
      ),
    )

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const summary = (await svc.messages({ sessionID: session.id })).find(
            (item) => item.info.role === "assistant" && item.info.summary,
          )

          expect(summary?.info.role).toBe("assistant")
          expect(summary?.parts.some((part) => part.type === "tool")).toBe(false)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("summarizes only the head while keeping recent tail out of summary input", async () => {
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "older context")
        await user(session.id, "keep this turn")
        await user(session.id, "and this one too")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(captured).toContain("older context")
          expect(captured).not.toContain("keep this turn")
          expect(captured).not.toContain("and this one too")
          expect(captured).not.toContain("What did we do so far?")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("keeps recent pre-compaction turns across repeated compactions", async () => {
    const stub = llm()
    stub.push(reply("summary one"))
    stub.push(reply("summary two"))
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const u1 = await user(session.id, "one")
        const u2 = await user(session.id, "two")
        const u3 = await user(session.id, "three")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg({ tail_turns: 2, preserve_recent_tokens: 10_000 }))
        try {
          let msgs = await svc.messages({ sessionID: session.id })
          let parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const u4 = await user(session.id, "four")
          await SessionCompaction.create({
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          })

          msgs = MessageV2.filterCompacted(MessageV2.stream(session.id))
          parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          const ids = filtered.map((msg) => msg.info.id)

          expect(ids).not.toContain(u1.id)
          expect(ids).not.toContain(u2.id)
          expect(ids).toContain(u3.id)
          expect(ids).toContain(u4.id)
          expect(filtered.some((msg) => msg.info.role === "assistant" && msg.info.summary)).toBe(true)
          expect(
            filtered.some((msg) => msg.info.role === "user" && msg.parts.some((part) => part.type === "compaction")),
          ).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})

describe("util.token.estimate", () => {
  test("estimates tokens from text (4 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1000)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(5000)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })
})

describe("SessionNs.getUsage", () => {
  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("subtracts cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    // AI SDK v6 normalizes inputTokens to include cached tokens for all providers
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("separates reasoning tokens from output tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: 400,
          reasoningTokens: 100,
        },
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(400)
    expect(result.tokens.reasoning).toBe(100)
    expect(result.tokens.total).toBe(1500)
  })

  test("does not double count reasoning tokens in cost", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 0,
        output: 15,
        cache: { read: 0, write: 0 },
      },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 1_000_000,
        totalTokens: 1_000_000,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: 750_000,
          reasoningTokens: 250_000,
        },
      },
    })

    expect(result.tokens.output).toBe(750_000)
    expect(result.tokens.reasoning).toBe(250_000)
    expect(result.cost).toBe(15)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(Number.isNaN(result.cost)).toBe(false)
  })

  test("calculates cost correctly", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.cost).toBe(3 + 1.5)
  })

  test.each(["@ai-sdk/anthropic", "@ai-sdk/amazon-bedrock", "@ai-sdk/google-vertex/anthropic"])(
    "computes total from components for %s models",
    (npm) => {
      const model = createModel({ context: 100_000, output: 32_000, npm })
      // AI SDK v6: inputTokens includes cached tokens for all providers
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      }
      if (npm === "@ai-sdk/amazon-bedrock") {
        const result = SessionNs.getUsage({
          model,
          usage,
          metadata: {
            bedrock: {
              usage: {
                cacheWriteInputTokens: 300,
              },
            },
          },
        })

        // inputTokens (1000) includes cache, so adjusted = 1000 - 200 - 300 = 500
        expect(result.tokens.input).toBe(500)
        expect(result.tokens.cache.read).toBe(200)
        expect(result.tokens.cache.write).toBe(300)
        // total = adjusted (500) + output (500) + cacheRead (200) + cacheWrite (300)
        expect(result.tokens.total).toBe(1500)
        return
      }

      const result = SessionNs.getUsage({
        model,
        usage,
        metadata: {
          anthropic: {
            cacheCreationInputTokens: 300,
          },
        },
      })

      // inputTokens (1000) includes cache, so adjusted = 1000 - 200 - 300 = 500
      expect(result.tokens.input).toBe(500)
      expect(result.tokens.cache.read).toBe(200)
      expect(result.tokens.cache.write).toBe(300)
      // total = adjusted (500) + output (500) + cacheRead (200) + cacheWrite (300)
      expect(result.tokens.total).toBe(1500)
    },
  )

  test("extracts cache write tokens from vertex metadata key", () => {
    const model = createModel({ context: 100_000, output: 32_000, npm: "@ai-sdk/google-vertex/anthropic" })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        vertex: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.input).toBe(500)
    expect(result.tokens.cache.read).toBe(200)
    expect(result.tokens.cache.write).toBe(300)
  })
})
