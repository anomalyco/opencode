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
const directory = AbsolutePath.make("/project")
const model = Model.Info.default(Provider.ID.make("test"), Model.ID.make("test-model"))

const anthropic = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })
const openai = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const stepRequest = (
  route: typeof anthropic | typeof openai,
  extra: Pick<Parameters<typeof ai.request>[0], "cache" | "providerOptions"> = {},
) =>
  ai.request({
    model: route,
    system: "You are concise.",
    messages: [Message.user("list the files")],
    maxTokens: 32_000,
    ...extra,
  })

const session = Session.Info.make({
  id: sessionID,
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory }),
})

const context: SessionContext = {
  sessionID,
  agent: Agent.ID.make("build"),
  model: { id: model.id, providerID: model.providerID },
  system: [],
  messages: [],
  tools: {},
  options: {},
}

const hit = { cacheReadInputTokens: 1000, cacheWriteInputTokens: 0 }

/**
 * Runs the warming plugin with the top-level `warming` on, a catalog of `models`, an LLM that reports `usage` for each
 * resent request, and a controllable event feed.
 */
const run = Effect.fnUntraced(function* (
  options: { readonly usage?: typeof hit; readonly models?: ReadonlyArray<Model.Info> } = {},
) {
  const refreshes: LLMRequest[] = []
  const prompts: string[] = []
  const events = yield* Queue.unbounded<SessionEvent.Execution.Succeeded>()
  let contextHook: ((input: SessionContext) => Effect.Effect<void>) | undefined
  const client = Layer.mock(LLMClient.Service)({
    stream: () => Stream.die(new Error("unused")),
    generate: (request) =>
      Effect.sync(() => {
        refreshes.push(request)
        const usage = { ...(options.usage ?? hit), outputTokens: 1 }
        const response = LLMResponse.fromEvents([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.stepFinish({ index: 0, reason: { normalized: "length" }, usage }),
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
  yield* WarmingPlugin.Plugin.effect(
    host({
      model: {
        list: () => Effect.succeed({ location: { directory }, data: options.models ?? [] }),
        default: () => Effect.die("unused model.default"),
        transform: () => Effect.die("unused model.transform"),
        reload: () => Effect.die("unused model.reload"),
      },
      event: { subscribe: () => Stream.fromQueue(events) },
      session: {
        get: () => Effect.succeed(session),
        generate: (input) =>
          Effect.sync(() => {
            prompts.push(input.prompt)
            return { text: "OK" }
          }),
        hook: (name, callback) => {
          if (name === "context") contextHook = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(Effect.provide(Layer.mergeAll(client, config, Layer.succeed(SessionWarmup.Service, warmup))))
  if (!contextHook) return yield* Effect.die("warming plugin did not register a context hook")
  const hook = contextHook
  /** One step: its context hook, then the runner recording what it sent. */
  const step = (request: LLMRequest) =>
    // Each request has its own hook event; the catalog lookup is cached on it.
    hook({ ...context }).pipe(Effect.andThen(warmup.record(sessionID, request, {})), Effect.andThen(Effect.yieldNow))
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
  return { refreshes, prompts, step, turnEnds, at }
})

describe("WarmingPlugin", () => {
  it.effect("resends the step request with a one-token limit just before its cache expires", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      const request = stepRequest(anthropic)
      yield* warming.step(request)
      yield* warming.turnEnds
      yield* warming.at(269)
      expect(warming.refreshes).toHaveLength(0)
      yield* warming.at(270)
      expect(warming.refreshes).toHaveLength(1)
      expect(warming.refreshes[0]?.messages).toBe(request.messages)
      expect(warming.refreshes[0]?.system).toBe(request.system)
      expect(warming.refreshes[0]?.maxTokens).toBe(1)
      expect(warming.prompts).toHaveLength(0)
    }),
  )

  it.effect("counts the interval from when the request was sent, not from the end of its response", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.step(stepRequest(anthropic))
      yield* warming.at(200)
      yield* warming.turnEnds
      yield* warming.at(275)
      expect(warming.refreshes).toHaveLength(1)
    }),
  )

  it.effect("skips a refresh once the response outlasted the cache entry", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.step(stepRequest(anthropic))
      yield* warming.at(295)
      yield* warming.turnEnds
      yield* warming.at(900)
      expect(warming.refreshes).toHaveLength(0)
    }),
  )

  it.effect("stops an idle session after the idle window", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.step(stepRequest(anthropic))
      yield* warming.turnEnds
      for (const seconds of [270, 540, 810, 1080, 1350]) yield* warming.at(seconds)
      expect(warming.refreshes).toHaveLength(3)
    }),
  )

  it.effect("stops after a refresh misses the cache", () =>
    Effect.gen(function* () {
      const warming = yield* run({ usage: { cacheReadInputTokens: 0, cacheWriteInputTokens: 5000 } })
      yield* warming.step(stepRequest(anthropic))
      yield* warming.turnEnds
      for (const seconds of [270, 540, 810]) yield* warming.at(seconds)
      expect(warming.refreshes).toHaveLength(1)
    }),
  )

  it.effect("times from the latest step's cache lifetime when it changes", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.step(stepRequest(anthropic, { cache: { ttl: "1h" } }))
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

  it.effect("doesn't warm a session whose provider caches implicitly", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.step(stepRequest(openai))
      yield* warming.turnEnds
      for (const seconds of [240, 480, 720]) yield* warming.at(seconds)
      expect(warming.refreshes).toHaveLength(0)
      expect(warming.prompts).toHaveLength(0)
    }),
  )

  it.effect("sends the keep-alive prompt to an implicit cache when the model's own cache.warming asks for it", () =>
    Effect.gen(function* () {
      const warming = yield* run({ models: [{ ...model, settings: { cache: { warming: true } } }] })
      yield* warming.step(stepRequest(openai))
      yield* warming.turnEnds
      yield* warming.at(240)
      expect(warming.prompts).toHaveLength(1)
      expect(warming.refreshes).toHaveLength(0)
    }),
  )

  it.effect("sends the keep-alive prompt when a thinking budget rules out a one-token resend", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.step(
        stepRequest(anthropic, { providerOptions: { thinking: { type: "enabled", budgetTokens: 8_000 } } }),
      )
      yield* warming.turnEnds
      yield* warming.at(240)
      expect(warming.prompts).toHaveLength(1)
      expect(warming.refreshes).toHaveLength(0)
    }),
  )
})
