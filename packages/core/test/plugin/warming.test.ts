import { describe, expect } from "bun:test"
import { Message } from "@opencode/ai/effect"
import { DateTime, Duration, Effect, Layer, Queue, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { SessionContext } from "@opencode/plugin/effect/session"
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
import { SessionMessage } from "@opencode/core/session/message"
import { Document, Info } from "@opencode/schema/config"
import { Event } from "@opencode/schema/event"
import { Money } from "@opencode/schema/money"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_warming_test")
const model = { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test") }
const session = Session.Info.make({
  id: sessionID,
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const durable = { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) }

const started = (): SessionEvent.Step.Started => ({
  id: Event.ID.create(),
  created: 0,
  durable,
  type: "session.step.started",
  data: {
    sessionID,
    assistantMessageID: SessionMessage.ID.make("msg_warming_test"),
    agent: Agent.ID.make("build"),
    model,
    started: 0,
  },
})

const streamed = (): SessionEvent.Step.Streamed => ({
  id: Event.ID.create(),
  created: 0,
  durable,
  type: "session.step.streamed",
  data: { sessionID, assistantMessageID: SessionMessage.ID.make("msg_warming_test") },
})

const request: SessionContext = {
  sessionID,
  agent: Agent.ID.make("build"),
  model,
  system: [],
  messages: [Message.user("hello")],
  tools: {},
  options: {},
}

describe("warming plugin", () => {
  it.effect("waits for an in-flight model request and counts the interval from its response", () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<SessionEvent.Step.Started | SessionEvent.Step.Streamed>()
      let pings = 0
      let context: ((input: SessionContext) => Effect.Effect<void>) | undefined
      yield* WarmingPlugin.Plugin.effect(
        host({
          event: { subscribe: () => Stream.fromQueue(events) },
          session: {
            get: () => Effect.succeed(session),
            generate: () => {
              pings += 1
              return Effect.succeed({ text: "OK" })
            },
            hook: (name, callback) => {
              if (name === "context") context = callback as (input: SessionContext) => Effect.Effect<void>
              return Effect.succeed({ dispose: Effect.void })
            },
          },
        }),
      ).pipe(
        Effect.provide(
          Layer.mock(Config.Service)({
            entries: () =>
              Effect.succeed([
                new Document({
                  type: "document",
                  info: new Info({ warming: { interval: Duration.minutes(4), duration: Duration.minutes(30) } }),
                }),
              ]),
          }),
        ),
      )
      if (!context) return yield* Effect.die("warming plugin did not register a context hook")

      // A real request starts at 0 and its response finishes at 5 minutes, past the 4-minute interval.
      yield* context(request)
      yield* Queue.offer(events, started())
      yield* TestClock.adjust(Duration.minutes(5))
      expect(pings).toBe(0)

      yield* Queue.offer(events, streamed())
      yield* TestClock.adjust(Duration.minutes(3))
      expect(pings).toBe(0)

      yield* TestClock.adjust(Duration.minutes(1))
      expect(pings).toBe(1)
    }),
  )
})
