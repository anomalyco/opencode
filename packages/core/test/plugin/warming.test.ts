import { describe, expect } from "bun:test"
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
import { Clock, DateTime, Effect, Queue, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_warming_test")
const directory = AbsolutePath.make("/project")
const model = Model.Info.default(Provider.ID.make("test"), Model.ID.make("test-model"))

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

/** Runs the warming plugin with the given top-level `warming` and a catalog holding the test model's `cache`. */
const run = Effect.fnUntraced(function* (warming: unknown, cache?: Provider.Cache) {
  const warms: number[] = []
  const events = yield* Queue.unbounded<SessionEvent.Execution.Succeeded>()
  let contextHook: ((input: SessionContext) => Effect.Effect<void>) | undefined
  yield* WarmingPlugin.Plugin.effect(
    host({
      model: {
        list: () => Effect.succeed({ location: { directory }, data: [{ ...model, settings: { cache } }] }),
        default: () => Effect.die("unused model.default"),
        transform: () => Effect.die("unused model.transform"),
        reload: () => Effect.die("unused model.reload"),
      },
      event: { subscribe: () => Stream.fromQueue(events) },
      session: {
        get: () => Effect.succeed(session),
        generate: () =>
          Clock.currentTimeMillis.pipe(
            Effect.map((now) => {
              warms.push(now / 60_000)
              return { text: "OK" }
            }),
          ),
        hook: (name, callback) => {
          if (name === "context") contextHook = callback as (input: SessionContext) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(
    Effect.provide(
      Config.testLayer([new Document({ type: "document", info: Schema.decodeUnknownSync(Info)({ warming }) })]),
    ),
  )
  if (!contextHook) return yield* Effect.die("warming plugin did not register a context hook")
  const hook = contextHook
  /** One whole turn: the step's context hook, then the turn ending. */
  const turn = Effect.gen(function* () {
    yield* hook({ ...context })
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

describe("WarmingPlugin interval", () => {
  it.effect("warms every 4 minutes when the model has no cache.ttl", () =>
    Effect.gen(function* () {
      const warming = yield* run(true)
      yield* warming.turn
      for (const minutes of [4, 8]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4, 8])
    }),
  )

  it.effect("warms at 90% of the model's cache.ttl by default", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, { ttl: "5m" })
      yield* warming.turn
      for (const minutes of [4, 4.5, 9]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4.5, 9])
    }),
  )

  it.effect("doesn't warm a cache that outlives the warming window", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, { ttl: "1h" })
      yield* warming.turn
      for (const minutes of [4, 27, 54]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([])
    }),
  )

  it.effect("keeps an explicit interval", () =>
    Effect.gen(function* () {
      const warming = yield* run({ interval: "2 minutes" }, { ttl: "5m" })
      yield* warming.turn
      for (const minutes of [2, 4]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([2, 4])
    }),
  )
})
