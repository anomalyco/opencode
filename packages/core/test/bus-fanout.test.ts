import { describe, expect, spyOn } from "bun:test"
import { Deferred, Effect, Fiber, Option, PubSub, Schema, Stream } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Event } from "@opencode/schema/event"
import { AbsolutePath } from "@opencode/schema/schema"
import { WorkspaceID } from "@opencode/schema/workspace-id"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node])))
const First = Bus.ephemeral({ type: "test.fanout.first", schema: { ordinal: Schema.Number } })
const Second = Bus.ephemeral({ type: "test.fanout.second", schema: { ordinal: Schema.Number } })
const a = Location.Ref.make({ directory: AbsolutePath.make("/fanout/a") })
const b = Location.Ref.make({ directory: AbsolutePath.make("/fanout/b") })
const workspace = Location.Ref.make({ directory: a.directory, workspaceID: WorkspaceID.make("wrk_fanout") })

// Observe the actual Effect delivery hot path, without replacing its behavior
// or adding production instrumentation. A rejected post-delivery predicate
// still increments these native subscriber visits.
const instrument = () => {
  const hubs = new Map<object, { ref?: Location.Ref; visits: number; scans: number }>()
  const restore: Array<() => void> = []
  const subscribe = PubSub.subscribe
  const subscriptionSpy = spyOn(PubSub, "subscribe").mockImplementation(function <A>(hub: PubSub.PubSub<A>) {
    return Effect.gen(function* () {
      if (!hubs.has(hub)) {
        const ref = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
        const stats = { ref, visits: 0, scans: 0 }
        hubs.set(hub, stats)
        const complete = hub.strategy.completeSubscribersUnsafe
        const scanSpy = spyOn(hub.strategy, "completeSubscribersUnsafe").mockImplementation(
          function (atomic, subscribers) {
            stats.visits += subscribers.size
            stats.scans++
            return complete.call(hub.strategy, atomic, subscribers)
          },
        )
        restore.push(() => scanSpy.mockRestore())
      }
      return yield* subscribe(hub)
    })
  })
  restore.push(() => subscriptionSpy.mockRestore())
  return {
    hubs,
    reset: () =>
      hubs.forEach((stats) => {
        stats.visits = 0
        stats.scans = 0
      }),
    restore: () => restore.reverse().forEach((restore) => restore()),
  }
}

describe("Bus pre-delivery Location fanout", () => {
  for (const count of [1, 220]) {
    it.effect(
      `does not visit unrelated native subscribers across ${count} Locations with 24 consumers each`,
      () =>
        Effect.gen(function* () {
          const probe = yield* Effect.acquireRelease(Effect.sync(instrument), (probe) => Effect.sync(probe.restore))
          const bus = yield* Bus.Service
          const received: Event.Payload[] = []
          const watch = (ref?: Location.Ref, mode = 0) => {
            const stream =
              mode === 0 ? bus.subscribe() : mode === 1 ? bus.subscribe(First) : bus.subscribe([First, Second])
            const run = stream.pipe(Stream.runForEach((event) => Effect.sync(() => received.push(event))))
            return (ref ? run.pipe(Effect.provideService(Location.Service, location(ref))) : run).pipe(
              Effect.forkScoped({ startImmediately: true }),
            )
          }
          for (let index = 0; index < count; index++) {
            const ref = Location.Ref.make({ directory: AbsolutePath.make(`/fanout/unrelated/${index}`) })
            for (let consumer = 0; consumer < 24; consumer++) yield* watch(ref, consumer % 3)
          }
          for (let consumer = 0; consumer < 24; consumer++) yield* watch(a, consumer % 3)
          yield* watch()
          yield* watch(undefined, 1)
          probe.reset()
          const start = performance.now()
          for (let ordinal = 0; ordinal < 30; ordinal++) {
            yield* bus.publish(First, { ordinal }, { location: a })
            yield* Effect.yieldNow
          }
          yield* Effect.yieldNow
          const unrelated = [...probe.hubs.values()].filter((hub) => hub.ref?.directory !== a.directory && hub.ref)
          expect(unrelated.reduce((sum, hub) => sum + hub.visits, 0)).toBe(0)
          expect(unrelated.reduce((sum, hub) => sum + hub.scans, 0)).toBe(0)
          expect([...probe.hubs.values()].reduce((sum, hub) => sum + hub.visits, 0)).toBe(30 * 26)
          expect(received).toHaveLength(30 * 26)
          console.log(
            JSON.stringify({
              locations: count,
              unrelatedConsumers: count * 24,
              events: 30,
              nativeSubscriberVisits: 30 * 26,
              unrelatedVisits: 0,
              elapsedMs: performance.now() - start,
            }),
          )
        }),
      30000,
    )
  }

  it.effect("preserves one ordered feed for typed, multi-type and wildcard consumers across broadcasts", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const gate = yield* Deferred.make<void>()
      const watch = (ref?: Location.Ref, mode = 0) => {
        const stream =
          mode === 0 ? bus.subscribe() : mode === 1 ? bus.subscribe(First) : bus.subscribe([Second, First, First])
        const run = stream.pipe(
          Stream.map((event) => event as Event.Payload<typeof First | typeof Second>),
          Stream.takeUntil((event) => event.type === First.type && event.data.ordinal === 99),
          Stream.mapEffect((event) => Deferred.await(gate).pipe(Effect.as(event.data.ordinal))),
          Stream.runCollect,
        )
        return (ref ? run.pipe(Effect.provideService(Location.Service, location(ref))) : run).pipe(
          Effect.forkScoped({ startImmediately: true }),
        )
      }
      const watchers = yield* Effect.forEach([a, workspace, b, undefined], (ref) =>
        Effect.forEach([0, 1, 2], (mode) => watch(ref, mode)),
      )
      for (let ordinal = 0; ordinal < 60; ordinal++) {
        const definition = ordinal % 2 === 0 ? First : Second
        if (ordinal % 3 === 0) yield* bus.publish(definition, { ordinal }, { location: a })
        if (ordinal % 3 === 1) yield* bus.publish(definition, { ordinal }, { location: workspace })
        if (ordinal % 3 === 2) yield* bus.publish(definition, { ordinal }, { global: true, location: a })
      }
      yield* bus.publish(First, { ordinal: 99 })
      yield* Deferred.succeed(gate, undefined)
      for (const [index, group] of watchers.entries()) {
        const all = Array.from({ length: 60 }, (_, ordinal) => ordinal).filter(
          (ordinal) => index === 3 || ordinal % 3 === 2 || (index < 2 && ordinal % 3 === index),
        )
        expect(yield* Fiber.join(group[0])).toEqual([...all, 99])
        expect(yield* Fiber.join(group[1])).toEqual([...all.filter((ordinal) => ordinal % 2 === 0), 99])
        expect(yield* Fiber.join(group[2])).toEqual([...all, 99])
      }
    }),
  )

  it.effect("reclaims channels after the last subscriber and creates fresh channels on resubscription", () =>
    Effect.gen(function* () {
      const probe = yield* Effect.acquireRelease(Effect.sync(instrument), (probe) => Effect.sync(probe.restore))
      const bus = yield* Bus.Service
      for (const mode of [0, 1, 2]) {
        const watch = () => {
          const stream =
            mode === 0 ? bus.subscribe() : mode === 1 ? bus.subscribe(First) : bus.subscribe([First, Second])
          return stream.pipe(
            Stream.runDrain,
            Effect.provideService(Location.Service, location(a)),
            Effect.forkScoped({ startImmediately: true }),
          )
        }
        const first = yield* watch()
        const second = yield* watch()
        const hub = [...probe.hubs.keys()].at(-1) as PubSub.PubSub<unknown>
        yield* Fiber.interrupt(first)
        expect(yield* PubSub.isShutdown(hub)).toBe(false)
        probe.reset()
        yield* bus.publish(First, { ordinal: 0 }, { location: a })
        expect([...probe.hubs.values()].reduce((sum, hub) => sum + hub.visits, 0)).toBe(1)
        yield* Fiber.interrupt(second)
        expect(yield* PubSub.isShutdown(hub)).toBe(true)
        probe.reset()
        yield* bus.publish(First, { ordinal: 1 }, { location: a })
        yield* bus.publish(First, { ordinal: 2 }, { global: true })
        expect([...probe.hubs.values()].reduce((sum, hub) => sum + hub.scans, 0)).toBe(0)
        const third = yield* watch()
        const fresh = [...probe.hubs.keys()].at(-1) as PubSub.PubSub<unknown>
        expect(fresh).not.toBe(hub)
        probe.reset()
        yield* bus.publish(First, { ordinal: 3 }, { location: a })
        expect([...probe.hubs.values()].reduce((sum, hub) => sum + hub.visits, 0)).toBe(1)
        yield* Fiber.interrupt(third)
        expect(yield* PubSub.isShutdown(fresh)).toBe(true)
      }
    }),
  )
})
