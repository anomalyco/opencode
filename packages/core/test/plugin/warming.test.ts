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
import { Clock, DateTime, Duration, Effect, Queue, Schema, Stream } from "effect"
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

const hit = { read: 1000, write: 10 }
const miss = { read: 0, write: 1000 }
const unreported = { read: 0, write: 0 }

/**
 * Runs the warming plugin with the given top-level `warming` and a catalog holding the test model's `cache`. Each ping
 * reports the next cache usage in `usage` and takes `ping` to respond.
 */
const run = Effect.fnUntraced(function* (
  warming: unknown,
  cache?: Provider.Cache,
  usage: ReadonlyArray<typeof hit> = [],
  ping = Duration.zero,
) {
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
              const cache = usage[warms.length] ?? unreported
              warms.push(now / 60_000)
              return { text: "OK", tokens: { input: 0, output: 1, reasoning: 0, cache }, cost: Money.USD.zero }
            }),
            Effect.tap(() => Effect.sleep(ping)),
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
  /** A request being sent: the step's context hook. */
  const send = hook({ ...context })
  /** The turn ending. */
  const end = Effect.gen(function* () {
    yield* Queue.offer(events, {
      id: Event.ID.create(),
      created: 0,
      durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
      type: "session.execution.succeeded",
      data: { sessionID },
    })
    yield* Effect.yieldNow
  })
  /** One whole turn whose response ends right away. */
  const turn = send.pipe(Effect.andThen(end))
  const at = (minutes: number) => TestClock.setTime(minutes * 60_000).pipe(Effect.andThen(Effect.yieldNow))
  return { warms, send, end, turn, at }
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

describe("WarmingPlugin cache miss", () => {
  it.effect("keeps warming after a ping hits the cache", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, undefined, [hit, hit, hit])
      yield* warming.turn
      for (const minutes of [4, 8, 12]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4, 8, 12])
    }),
  )

  it.effect("stops warming after a ping misses the cache", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, undefined, [hit, miss, hit])
      yield* warming.turn
      for (const minutes of [4, 8, 12, 16]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4, 8])
    }),
  )

  it.effect("resumes warming on the next real request after a miss", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, undefined, [miss, hit, hit])
      yield* warming.turn
      for (const minutes of [4, 8]) yield* warming.at(minutes)
      yield* warming.turn
      for (const minutes of [12, 16]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4, 12, 16])
    }),
  )

  it.effect("doesn't count a ping without cache usage as a miss", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, undefined, [unreported, unreported])
      yield* warming.turn
      for (const minutes of [4, 8]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4, 8])
    }),
  )

  it.effect("keeps warming when a request is sent while a missed ping responds", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, { ttl: "5m" }, [miss, hit], Duration.seconds(30))
      yield* warming.turn
      yield* warming.at(4.5)
      yield* warming.at(4.75)
      yield* warming.turn
      for (const minutes of [5, 9.25]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4.5, 9.25])
    }),
  )
})

describe("WarmingPlugin timing", () => {
  it.effect("counts the interval from when the request was sent, not when its response ended", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, { ttl: "5m" })
      yield* warming.send
      yield* warming.at(1)
      yield* warming.end
      for (const minutes of [4.5, 5.5]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4.5])
    }),
  )

  it.effect("counts the next interval from when a ping was sent", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, { ttl: "5m" }, [], Duration.seconds(30))
      yield* warming.turn
      for (const minutes of [4.5, 9, 9.5]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4.5, 9])
    }),
  )

  it.effect("waits for a request running at the due time, then pings while the cache lasts", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, { ttl: "5m" })
      yield* warming.send
      yield* warming.at(4.5)
      expect(warming.warms).toEqual([])
      yield* warming.at(4.75)
      yield* warming.end
      for (const minutes of [9, 9.25]) yield* warming.at(minutes)
      expect(warming.warms).toEqual([4.75, 9.25])
    }),
  )

  it.effect("stops warming when a request outlasts the cache, until the next request", () =>
    Effect.gen(function* () {
      const warming = yield* run(true, { ttl: "5m" })
      yield* warming.send
      yield* warming.at(6)
      yield* warming.end
      yield* warming.at(15)
      expect(warming.warms).toEqual([])
      yield* warming.turn
      yield* warming.at(19.5)
      expect(warming.warms).toEqual([19.5])
    }),
  )
})
