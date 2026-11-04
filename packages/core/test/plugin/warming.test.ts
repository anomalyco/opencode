import { describe, expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { WarmingPlugin } from "@opencode/core/plugin/warming"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Document } from "@opencode/schema/config"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "../lib/effect"

const providerID = Provider.ID.make("test")
const sessionID = Session.ID.make("ses_warming")
const models = {
  short: { ttl: "5m" },
  long: { ttl: "20m" },
  uncached: {},
} as const

const config = [new Document({ type: "document", info: { warming: { interval: "auto" } } })]
const it = testEffect(Layer.mock(Config.Service, { entries: () => Effect.succeed(config), snapshot: () => config }))

const start = Effect.gen(function* () {
  const hooks = new Map<string, (event: SessionHooks["context"]) => Effect.Effect<void>>()
  const warmed: string[] = []
  const ctx = {
    event: { subscribe: () => Stream.never },
    model: {
      list: () =>
        Effect.succeed({
          data: Object.entries(models).map(([id, cache]) => ({
            ...Model.Info.default(providerID, Model.ID.make(id)),
            settings: { cache },
          })),
        }),
    },
    session: {
      get: () => Effect.succeed({ parentID: undefined }),
      // Like the real one, a keep-alive runs the generate hook before it is sent, and takes a while, so overlapping
      // loops would each send one.
      generate: () =>
        turn("short").pipe(
          Effect.andThen(Effect.sync(() => void warmed.push("keep-alive"))),
          Effect.andThen(Effect.sleep("30 seconds")),
        ),
      hook: (name: string, callback: (event: SessionHooks["context"]) => Effect.Effect<void>) =>
        Effect.sync(() => void hooks.set(name, callback)),
    },
  } as unknown as Context
  yield* WarmingPlugin.Plugin.effect(ctx)
  // The generate hook schedules like a turn's context hook, without leaving a request in flight.
  const turn = (model: keyof typeof models) =>
    hooks.get("generate")!({
      sessionID,
      model: Model.Ref.make({ providerID, id: Model.ID.make(model) }),
      messages: [],
    } as unknown as SessionHooks["context"]).pipe(Effect.andThen(Effect.yieldNow))
  return { warmed, turn }
})

describe("WarmingPlugin", () => {
  it.effect("keeps one loop per session when its model switches warming off and on", () =>
    Effect.gen(function* () {
      const { warmed, turn } = yield* start
      for (const model of ["short", "uncached", "short", "uncached", "short"] as const) yield* turn(model)

      yield* TestClock.adjust("271 seconds")
      expect(warmed).toEqual(["keep-alive"])
    }),
  )

  it.effect("times the next keep-alive from the model a session switched to", () =>
    Effect.gen(function* () {
      const { warmed, turn } = yield* start
      yield* turn("long")
      yield* TestClock.adjust("1 minute")
      yield* turn("short")

      yield* TestClock.adjust("271 seconds")
      expect(warmed).toEqual(["keep-alive"])
    }),
  )

  it.effect("keeps warming while each keep-alive runs the generate hook", () =>
    Effect.gen(function* () {
      const { warmed, turn } = yield* start
      yield* turn("short")

      yield* TestClock.adjust("10 minutes")
      expect(warmed).toEqual(["keep-alive", "keep-alive"])
    }),
  )
})
