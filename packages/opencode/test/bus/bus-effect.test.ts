import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Latch, Layer, Schema, Stream } from "effect"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const TestEvent = {
  Ping: BusEvent.define("test.effect.ping", Schema.Struct({ value: Schema.Number })),
  Pong: BusEvent.define("test.effect.pong", Schema.Struct({ message: Schema.String })),
  Warmup: BusEvent.define("test.effect.warmup", Schema.Struct({})),
}

const node = CrossSpawnSpawner.defaultLayer

const live = Layer.mergeAll(Bus.layer, node)

const it = testEffect(live)

// Publishes warmup events until the latch opens, proving the forked subscriber
// fiber has actually wired up its PubSub subscription.
const awaitSubscriberReady = Effect.fn("test.awaitSubscriberReady")(function* (
  ready: Latch.Latch,
  warmup: Effect.Effect<void>,
) {
  const pump = yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* warmup
        yield* Effect.sleep("5 millis")
      }
    }),
  )
  yield* ready.await.pipe(Effect.timeout("2 seconds"))
  yield* Fiber.interrupt(pump)
})

describe("Bus (Effect-native)", () => {
  it.instance("publish + subscribe stream delivers events", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received: number[] = []
      const done = yield* Deferred.make<void>()
      const ready = yield* Latch.make()

      yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
        Effect.gen(function* () {
          if (evt.properties.value < 0) {
            yield* ready.open
            return
          }
          received.push(evt.properties.value)
          if (received.length === 2) Deferred.doneUnsafe(done, Effect.void)
        }),
      ).pipe(Effect.forkScoped)

      yield* awaitSubscriberReady(ready, bus.publish(TestEvent.Ping, { value: -1 }))
      yield* bus.publish(TestEvent.Ping, { value: 1 })
      yield* bus.publish(TestEvent.Ping, { value: 2 })
      yield* Deferred.await(done)

      expect(received).toEqual([1, 2])
    }),
  )

  it.instance("subscribe filters by event type", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const pings: number[] = []
      const done = yield* Deferred.make<void>()
      const ready = yield* Latch.make()

      yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
        Effect.gen(function* () {
          if (evt.properties.value < 0) {
            yield* ready.open
            return
          }
          pings.push(evt.properties.value)
          Deferred.doneUnsafe(done, Effect.void)
        }),
      ).pipe(Effect.forkScoped)

      yield* awaitSubscriberReady(ready, bus.publish(TestEvent.Ping, { value: -1 }))
      yield* bus.publish(TestEvent.Pong, { message: "ignored" })
      yield* bus.publish(TestEvent.Ping, { value: 42 })
      yield* Deferred.await(done)

      expect(pings).toEqual([42])
    }),
  )

  it.instance("subscribeAll receives all types", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const types: string[] = []
      const done = yield* Deferred.make<void>()
      const ready = yield* Latch.make()

      yield* Stream.runForEach(bus.subscribeAll(), (evt) =>
        Effect.gen(function* () {
          if (evt.type === TestEvent.Warmup.type) {
            yield* ready.open
            return
          }
          types.push(evt.type)
          if (types.length === 2) Deferred.doneUnsafe(done, Effect.void)
        }),
      ).pipe(Effect.forkScoped)

      yield* awaitSubscriberReady(ready, bus.publish(TestEvent.Warmup, {}))
      yield* bus.publish(TestEvent.Ping, { value: 1 })
      yield* bus.publish(TestEvent.Pong, { message: "hi" })
      yield* Deferred.await(done)

      expect(types).toContain("test.effect.ping")
      expect(types).toContain("test.effect.pong")
    }),
  )

  it.instance("multiple subscribers each receive the event", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const a: number[] = []
      const b: number[] = []
      const doneA = yield* Deferred.make<void>()
      const doneB = yield* Deferred.make<void>()
      const readyA = yield* Latch.make()
      const readyB = yield* Latch.make()

      yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
        Effect.gen(function* () {
          if (evt.properties.value < 0) {
            yield* readyA.open
            return
          }
          a.push(evt.properties.value)
          Deferred.doneUnsafe(doneA, Effect.void)
        }),
      ).pipe(Effect.forkScoped)

      yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
        Effect.gen(function* () {
          if (evt.properties.value < 0) {
            yield* readyB.open
            return
          }
          b.push(evt.properties.value)
          Deferred.doneUnsafe(doneB, Effect.void)
        }),
      ).pipe(Effect.forkScoped)

      yield* awaitSubscriberReady(readyA, bus.publish(TestEvent.Ping, { value: -1 }))
      yield* awaitSubscriberReady(readyB, bus.publish(TestEvent.Ping, { value: -1 }))
      yield* bus.publish(TestEvent.Ping, { value: 99 })
      yield* Deferred.await(doneA)
      yield* Deferred.await(doneB)

      expect(a).toEqual([99])
      expect(b).toEqual([99])
    }),
  )

  it.live("subscribeAll stream sees InstanceDisposed on disposal", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const types: string[] = []
      const seen = yield* Deferred.make<void>()
      const disposed = yield* Deferred.make<void>()
      const ready = yield* Latch.make()

      // Set up subscriber inside the instance
      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service

        yield* Stream.runForEach(bus.subscribeAll(), (evt) =>
          Effect.gen(function* () {
            if (evt.type === TestEvent.Warmup.type) {
              yield* ready.open
              return
            }
            types.push(evt.type)
            if (evt.type === TestEvent.Ping.type) Deferred.doneUnsafe(seen, Effect.void)
            if (evt.type === Bus.InstanceDisposed.type) Deferred.doneUnsafe(disposed, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* awaitSubscriberReady(ready, bus.publish(TestEvent.Warmup, {}))
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* Deferred.await(seen)
      }).pipe(provideInstance(dir))

      // Dispose from OUTSIDE the instance scope
      yield* Effect.promise(disposeAllInstances)
      yield* Deferred.await(disposed).pipe(Effect.timeout("2 seconds"))

      expect(types).toContain("test.effect.ping")
      expect(types).toContain(Bus.InstanceDisposed.type)
    }),
  )
})
