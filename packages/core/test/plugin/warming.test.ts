import { describe, expect } from "bun:test"
import { ai, LLMClient, LLMEvent, LLMResponse, Message, type LLMRequest } from "@opencode/ai/effect"
import { Auth } from "@opencode/ai/route"
import { AnthropicMessages, OpenAIChat } from "@opencode/ai/protocols"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { Document, Info } from "@opencode/schema/config"
import { Event } from "@opencode/schema/event"
import { Money } from "@opencode/schema/money"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { WarmingPlugin } from "@opencode/core/plugin/warming"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionWarmup } from "@opencode/core/session/warmup"
import { DateTime, Effect, Layer, Queue, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_warming_test")

const anthropic = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })
const openai = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const stepRequest = (model: typeof anthropic | typeof openai, ttl?: "1h") =>
  ai.request({
    model,
    system: "You are concise.",
    messages: [Message.user("list the files")],
    generation: { maxTokens: 32_000 },
    ...(ttl ? { cache: { ttl } } : {}),
  })

const session = Session.Info.make({
  id: sessionID,
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})

const context: SessionContext = {
  sessionID,
  agent: Agent.ID.make("build"),
  model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") },
  system: [],
  messages: [],
  tools: {},
  options: {},
}

/** Runs the warming plugin with warming on, an LLM that reports `usage` for each refresh, and a controllable event feed. */
const run = Effect.fnUntraced(function* (usage: { cacheReadInputTokens: number; cacheWriteInputTokens: number }) {
  const refreshes: LLMRequest[] = []
  const events = yield* Queue.unbounded<SessionEvent.Execution.Succeeded>()
  let contextHook: ((input: SessionContext) => Effect.Effect<void>) | undefined
  const client = Layer.mock(LLMClient.Service)({
    stream: () => Stream.die(new Error("unused")),
    generate: (request) =>
      Effect.sync(() => {
        refreshes.push(request)
        const response = LLMResponse.fromEvents([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.stepFinish({ index: 0, reason: { normalized: "length" }, usage: { ...usage, outputTokens: 1 } }),
          LLMEvent.finish({ reason: { normalized: "length" } }),
        ])
        if (!response) throw new Error("Incomplete generate response")
        return response
      }),
  })
  const config = Config.testLayer([
    new Document({ type: "document", info: Schema.decodeUnknownSync(Info)({ warming: true }) }),
  ])
  // The runner and the plugin share one recorder; the test plays the runner.
  const warmup = yield* SessionWarmup.Service.pipe(Effect.provide(SessionWarmup.layer))
  const layer = Layer.mergeAll(client, config, Layer.succeed(SessionWarmup.Service, warmup))
  yield* WarmingPlugin.Plugin.effect(
    host({
      model: {
        // An unreadable catalog falls back to the top-level setting.
        list: () => Effect.fail(new Error("no catalog")),
        default: () => Effect.die("unused model.default"),
        transform: () => Effect.die("unused model.transform"),
        reload: () => Effect.die("unused model.reload"),
      },
      event: { subscribe: () => Stream.fromQueue(events) },
      session: {
        get: () => Effect.succeed(session),
        hook: (name, callback) => {
          if (name === "context") contextHook = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(Effect.provide(layer))
  if (!contextHook) return yield* Effect.die("warming plugin did not register a context hook")
  const hook = contextHook
  /** One step: its context hook, then the runner recording what it sent. */
  const step = (request: LLMRequest) =>
    hook(context).pipe(Effect.andThen(warmup.record(sessionID, request, {})), Effect.andThen(Effect.yieldNow))
  const turnEnds = Effect.gen(function* () {
    yield* Queue.offer(events, {
      id: Event.ID.create(),
      created: 0,
      durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
      type: "session.execution.succeeded",
      data: { sessionID },
    })
    yield* Effect.yieldNow
  })
  const at = (seconds: number) => TestClock.setTime(seconds * 1000).pipe(Effect.andThen(Effect.yieldNow))
  return { refreshes, step, turnEnds, at }
})

describe("WarmingPlugin", () => {
  it.effect("resends the step request with a one-token limit just before its cache expires", () =>
    Effect.gen(function* () {
      const warming = yield* run({ cacheReadInputTokens: 1000, cacheWriteInputTokens: 0 })
      const request = stepRequest(anthropic)
      yield* warming.step(request)
      yield* warming.turnEnds
      yield* warming.at(269)
      expect(warming.refreshes).toHaveLength(0)
      yield* warming.at(270)
      expect(warming.refreshes).toHaveLength(1)
      expect(warming.refreshes[0]?.messages).toBe(request.messages)
      expect(warming.refreshes[0]?.system).toBe(request.system)
      expect(warming.refreshes[0]?.generation?.maxTokens).toBe(1)
    }),
  )

  it.effect("counts the interval from when the request was sent, not from the end of its response", () =>
    Effect.gen(function* () {
      const warming = yield* run({ cacheReadInputTokens: 1000, cacheWriteInputTokens: 0 })
      yield* warming.step(stepRequest(anthropic))
      yield* warming.at(200)
      yield* warming.turnEnds
      yield* warming.at(275)
      expect(warming.refreshes).toHaveLength(1)
    }),
  )

  it.effect("skips a refresh once the response outlasted the cache entry", () =>
    Effect.gen(function* () {
      const warming = yield* run({ cacheReadInputTokens: 1000, cacheWriteInputTokens: 0 })
      yield* warming.step(stepRequest(anthropic))
      yield* warming.at(295)
      yield* warming.turnEnds
      yield* warming.at(900)
      expect(warming.refreshes).toHaveLength(0)
    }),
  )

  it.effect("stops an idle session after the idle window", () =>
    Effect.gen(function* () {
      const warming = yield* run({ cacheReadInputTokens: 1000, cacheWriteInputTokens: 0 })
      yield* warming.step(stepRequest(anthropic))
      yield* warming.turnEnds
      for (const seconds of [270, 540, 810, 1080, 1350]) yield* warming.at(seconds)
      expect(warming.refreshes).toHaveLength(3)
    }),
  )

  it.effect("stops after a refresh misses the cache", () =>
    Effect.gen(function* () {
      const warming = yield* run({ cacheReadInputTokens: 0, cacheWriteInputTokens: 5000 })
      yield* warming.step(stepRequest(anthropic))
      yield* warming.turnEnds
      for (const seconds of [270, 540, 810]) yield* warming.at(seconds)
      expect(warming.refreshes).toHaveLength(1)
    }),
  )

  it.effect("times from the latest step's cache lifetime when it changes", () =>
    Effect.gen(function* () {
      const warming = yield* run({ cacheReadInputTokens: 1000, cacheWriteInputTokens: 0 })
      yield* warming.step(stepRequest(anthropic, "1h"))
      yield* warming.turnEnds
      yield* warming.at(60)
      const request = stepRequest(anthropic)
      yield* warming.step(request)
      yield* warming.turnEnds
      yield* warming.at(329)
      expect(warming.refreshes).toHaveLength(0)
      yield* warming.at(335)
      expect(warming.refreshes).toHaveLength(1)
      expect(warming.refreshes[0]?.messages).toBe(request.messages)
    }),
  )

  it.effect("doesn't warm a route that caches without markers", () =>
    Effect.gen(function* () {
      const warming = yield* run({ cacheReadInputTokens: 1000, cacheWriteInputTokens: 0 })
      yield* warming.step(stepRequest(openai))
      yield* warming.turnEnds
      for (const seconds of [270, 540, 810]) yield* warming.at(seconds)
      expect(warming.refreshes).toHaveLength(0)
    }),
  )
})
