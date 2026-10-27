import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Schema, Scope, Stream } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { RuntimeStats } from "@opencode/core/runtime-stats"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const Ping = Bus.ephemeral({ type: "test.runtime-stats.ping", schema: { n: Schema.Number } })

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, RuntimeStats.node])))

describe("RuntimeStats", () => {
  it.live("sums same-named gauges and drops them with their scope", () =>
    Effect.gen(function* () {
      const stats = yield* RuntimeStats.Service
      const outer = yield* Scope.make()
      yield* RuntimeStats.gauge("test.gauge", () => ({ size: 3 })).pipe(Scope.provide(outer))
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* RuntimeStats.gauge("test.gauge", () => ({ size: 2 }))
          expect(stats.read()).toMatchObject({ "test.gauge.size": 5, "test.gauge.instances": 2 })
        }),
      )
      expect(stats.read()["test.gauge.size"]).toBe(3)
      yield* Scope.close(outer, Exit.void)
      expect(stats.read()["test.gauge.size"]).toBeUndefined()
    }),
  )

  it.live("a throwing gauge reports -1 instead of failing the read", () =>
    Effect.gen(function* () {
      yield* RuntimeStats.gauge("test.throws", () => {
        throw new Error("boom")
      })
      expect((yield* RuntimeStats.Service).read()["test.throws"]).toBe(-1)
    }),
  )

  it.live("bus backlog counts events pinned by a stalled live subscriber", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const stats = yield* RuntimeStats.Service
      const backlog = () => stats.read()["bus.live.backlog"]
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const drained = yield* Deferred.make<void>()
      // Takes the first event, then blocks: every later event stays buffered for it.
      yield* bus.subscribe([Ping]).pipe(
        Stream.runForEach((event) =>
          event.data.n === 50
            ? Deferred.succeed(drained, undefined)
            : Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
        ),
        Effect.forkScoped,
      )
      yield* Effect.yieldNow
      yield* bus.publish(Ping, { n: 0 })
      yield* Deferred.await(started)
      for (let n = 1; n <= 50; n++) yield* bus.publish(Ping, { n })
      expect(backlog()).toBeGreaterThanOrEqual(49)
      yield* Deferred.succeed(release, undefined)
      // The subscriber has taken the last event, so nothing is left buffered for it.
      yield* Deferred.await(drained)
      expect(backlog()).toBe(0)
    }),
  )
})
