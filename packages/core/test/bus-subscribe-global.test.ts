import { describe, expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node])))

const a = Location.Ref.make({ directory: AbsolutePath.make("/a") })
const b = Location.Ref.make({ directory: AbsolutePath.make("/b") })
const Done = Bus.ephemeral({ type: "test.global.done", schema: {} })
const Ping = Bus.ephemeral({ type: "test.global.ping", schema: {} })

describe("Bus subscribeGlobal", () => {
  it.effect("sees other-location events that scoped subscribe filters out", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const scoped = yield* bus
        .subscribe()
        .pipe(
          Stream.takeUntil((event) => event.type === Done.type),
          Stream.runCollect,
          Effect.provideService(Location.Service, location(b)),
          Effect.forkScoped({ startImmediately: true }),
        )
      const global = yield* bus
        .subscribeGlobal()
        .pipe(
          Stream.takeUntil((event) => event.type === Done.type),
          Stream.runCollect,
          Effect.forkScoped({ startImmediately: true }),
        )
      // Both subscriptions fork with startImmediately, matching the
      // bus-session-routing pattern, before publishing.
      const ping = yield* bus.publish(Ping, {}, { location: a })
      const done = yield* bus.publish(Done, {}, { global: true })
      const scopedEvents = Array.from(yield* Fiber.join(scoped))
      const globalEvents = Array.from(yield* Fiber.join(global))
      // Scoped to /b: location-A ping is filtered, global done passes through.
      expect(scopedEvents.map((event) => event.type)).toEqual([Done.type])
      expect(globalEvents.map((event) => event.type)).toEqual([Ping.type, Done.type])
      expect(globalEvents[0]).toEqual(ping)
      expect(globalEvents[1]).toEqual(done)
    }),
  )

  it.effect("filters by definition when one is given", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const filtered = yield* bus
        .subscribeGlobal(Ping)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
      // Done is published so the bus has more than one event type in flight;
      // the definition-filtered stream must only ever see Ping.
      yield* bus.publish(Done, {}, { global: true })
      yield* bus.publish(Ping, {}, { location: a })
      const events = Array.from(yield* Fiber.join(filtered))
      expect(events.map((event) => event.type)).toEqual([Ping.type])
    }),
  )
})
