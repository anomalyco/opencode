import { describe, expect } from "bun:test"
import { ai, Message, type LLMRequest } from "@opencode/ai/effect"
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

const stepRequest = (route: typeof anthropic | typeof openai) =>
  ai.request({ model: route, system: "You are concise.", messages: [Message.user("list the files")] })

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

/** Runs the warming plugin with the top-level `warming` on, a catalog of `models`, and a controllable event feed. */
const run = Effect.fnUntraced(function* (models: ReadonlyArray<Model.Info> = []) {
  const warms: string[] = []
  const events = yield* Queue.unbounded<SessionEvent.Execution.Succeeded>()
  let contextHook: ((input: SessionContext) => Effect.Effect<void>) | undefined
  const config = Config.testLayer([
    new Document({ type: "document", info: Schema.decodeUnknownSync(Info)({ warming: true }) }),
  ])
  // The runner and the plugin share one recorder; the test plays the runner.
  const warmup = yield* SessionWarmup.Service.pipe(Effect.provide(SessionWarmup.layer))
  yield* WarmingPlugin.Plugin.effect(
    host({
      model: {
        list: () => Effect.succeed({ location: { directory }, data: models }),
        default: () => Effect.die("unused model.default"),
        transform: () => Effect.die("unused model.transform"),
        reload: () => Effect.die("unused model.reload"),
      },
      event: { subscribe: () => Stream.fromQueue(events) },
      session: {
        get: () => Effect.succeed(session),
        generate: (input) =>
          Effect.sync(() => {
            warms.push(input.prompt)
            return { text: "OK" }
          }),
        hook: (name, callback) => {
          if (name === "context") contextHook = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(Effect.provide(Layer.mergeAll(config, Layer.succeed(SessionWarmup.Service, warmup))))
  if (!contextHook) return yield* Effect.die("warming plugin did not register a context hook")
  const hook = contextHook
  /** One whole turn: the step's context hook, the runner recording what it sent, and the turn ending. */
  const turn = (request: LLMRequest) =>
    Effect.gen(function* () {
      // Each request has its own hook event; the catalog lookup is cached on it.
      yield* hook({ ...context })
      yield* warmup.record(sessionID, request)
      yield* Queue.offer(events, {
        id: Event.ID.create(),
        created: 0,
        durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
        type: "session.execution.succeeded",
        data: { sessionID },
      })
      yield* Effect.yieldNow
    })
  const at = (minutes: number) => TestClock.setTime(minutes * 60_000).pipe(Effect.andThen(Effect.yieldNow))
  return { warms, turn, at }
})

describe("WarmingPlugin", () => {
  it.effect("warms a session whose provider caches at explicit markers", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.turn(stepRequest(anthropic))
      yield* warming.at(4)
      expect(warming.warms).toHaveLength(1)
    }),
  )

  it.effect("doesn't warm a session whose provider caches implicitly", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.turn(stepRequest(openai))
      for (const minutes of [4, 8, 12]) yield* warming.at(minutes)
      expect(warming.warms).toHaveLength(0)
    }),
  )

  it.effect("warms an implicit cache when the model's own cache.warming asks for it", () =>
    Effect.gen(function* () {
      const warming = yield* run([{ ...model, settings: { cache: { warming: true } } }])
      yield* warming.turn(stepRequest(openai))
      yield* warming.at(4)
      expect(warming.warms).toHaveLength(1)
    }),
  )

  it.effect("follows the session when it switches to a provider that caches implicitly", () =>
    Effect.gen(function* () {
      const warming = yield* run()
      yield* warming.turn(stepRequest(anthropic))
      yield* warming.at(1)
      yield* warming.turn(stepRequest(openai))
      for (const minutes of [5, 9]) yield* warming.at(minutes)
      expect(warming.warms).toHaveLength(0)
    }),
  )
})
