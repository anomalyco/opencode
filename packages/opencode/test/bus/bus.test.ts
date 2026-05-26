import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Layer, Schema } from "effect"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const TestEvent = {
  Ping: BusEvent.define("test.ping", Schema.Struct({ value: Schema.Number })),
  Pong: BusEvent.define("test.pong", Schema.Struct({ message: Schema.String })),
}

const it = testEffect(Layer.mergeAll(Bus.layer, CrossSpawnSpawner.defaultLayer))

describe("Bus", () => {
  afterEach(() => disposeAllInstances())

  describe("publish + subscribe", () => {
    it.instance("subscriber is live immediately after subscribe returns", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: number[] = []
        const done = yield* Deferred.make<void>()

        yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
          received.push(evt.properties.value)
          Deferred.doneUnsafe(done, Effect.void)
        })
        yield* bus.publish(TestEvent.Ping, { value: 42 })
        yield* Deferred.await(done).pipe(Effect.timeout("2 seconds"))

        expect(received).toEqual([42])
      }),
    )

    it.instance("subscriber receives matching events", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: number[] = []
        const done = yield* Deferred.make<void>()

        yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
          received.push(evt.properties.value)
          if (received.length === 2) Deferred.doneUnsafe(done, Effect.void)
        })
        yield* bus.publish(TestEvent.Ping, { value: 42 })
        yield* bus.publish(TestEvent.Ping, { value: 99 })
        yield* Deferred.await(done).pipe(Effect.timeout("2 seconds"))

        expect(received).toEqual([42, 99])
      }),
    )

    it.instance("subscriber does not receive events of other types", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const pings: number[] = []
        const done = yield* Deferred.make<void>()

        yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
          pings.push(evt.properties.value)
          Deferred.doneUnsafe(done, Effect.void)
        })
        yield* bus.publish(TestEvent.Pong, { message: "hello" })
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* Deferred.await(done).pipe(Effect.timeout("2 seconds"))

        expect(pings).toEqual([1])
      }),
    )

    it.instance("publish with no subscribers does not throw", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        yield* bus.publish(TestEvent.Ping, { value: 1 })
      }),
    )
  })

  describe("unsubscribe", () => {
    it.instance("unsubscribe stops delivery", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: number[] = []
        const first = yield* Deferred.make<void>()

        const unsub = yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
          received.push(evt.properties.value)
          if (evt.properties.value === 1) Deferred.doneUnsafe(first, Effect.void)
        })
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* Deferred.await(first).pipe(Effect.timeout("2 seconds"))
        yield* Effect.sync(unsub)
        yield* bus.publish(TestEvent.Ping, { value: 2 })
        yield* Effect.sleep("10 millis")

        expect(received).toEqual([1])
      }),
    )
  })

  describe("subscribeAll", () => {
    it.instance("subscribeAll is live immediately after subscribe returns", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: string[] = []
        const done = yield* Deferred.make<void>()

        yield* bus.subscribeAllCallback((evt) => {
          received.push(evt.type)
          Deferred.doneUnsafe(done, Effect.void)
        })
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* Deferred.await(done).pipe(Effect.timeout("2 seconds"))

        expect(received).toEqual(["test.ping"])
      }),
    )

    it.instance("receives all event types", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: string[] = []
        const done = yield* Deferred.make<void>()

        yield* bus.subscribeAllCallback((evt) => {
          received.push(evt.type)
          if (received.length === 2) Deferred.doneUnsafe(done, Effect.void)
        })
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* bus.publish(TestEvent.Pong, { message: "hi" })
        yield* Deferred.await(done).pipe(Effect.timeout("2 seconds"))

        expect(received).toContain("test.ping")
        expect(received).toContain("test.pong")
      }),
    )
  })

  describe("multiple subscribers", () => {
    it.instance("all subscribers for same event type are called", () =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const a: number[] = []
        const b: number[] = []
        const doneA = yield* Deferred.make<void>()
        const doneB = yield* Deferred.make<void>()

        yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
          a.push(evt.properties.value)
          Deferred.doneUnsafe(doneA, Effect.void)
        })
        yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
          b.push(evt.properties.value)
          Deferred.doneUnsafe(doneB, Effect.void)
        })
        yield* bus.publish(TestEvent.Ping, { value: 7 })
        yield* Deferred.await(doneA).pipe(Effect.timeout("2 seconds"))
        yield* Deferred.await(doneB).pipe(Effect.timeout("2 seconds"))

        expect(a).toEqual([7])
        expect(b).toEqual([7])
      }),
    )
  })

  describe("instance isolation", () => {
    it.live("events in one directory do not reach subscribers in another", () =>
      Effect.gen(function* () {
        const tmpA = yield* tmpdirScoped()
        const tmpB = yield* tmpdirScoped()
        const receivedA: number[] = []
        const receivedB: number[] = []
        const doneA = yield* Deferred.make<void>()
        const doneB = yield* Deferred.make<void>()

        yield* Effect.gen(function* () {
          const bus = yield* Bus.Service
          yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
            receivedA.push(evt.properties.value)
            Deferred.doneUnsafe(doneA, Effect.void)
          })
        }).pipe(provideInstance(tmpA))

        yield* Effect.gen(function* () {
          const bus = yield* Bus.Service
          yield* bus.subscribeCallback(TestEvent.Ping, (evt) => {
            receivedB.push(evt.properties.value)
            Deferred.doneUnsafe(doneB, Effect.void)
          })
        }).pipe(provideInstance(tmpB))

        yield* Effect.gen(function* () {
          const bus = yield* Bus.Service
          yield* bus.publish(TestEvent.Ping, { value: 1 })
        }).pipe(provideInstance(tmpA))

        yield* Effect.gen(function* () {
          const bus = yield* Bus.Service
          yield* bus.publish(TestEvent.Ping, { value: 2 })
        }).pipe(provideInstance(tmpB))

        yield* Deferred.await(doneA).pipe(Effect.timeout("2 seconds"))
        yield* Deferred.await(doneB).pipe(Effect.timeout("2 seconds"))

        expect(receivedA).toEqual([1])
        expect(receivedB).toEqual([2])
      }),
    )
  })

  describe("instance disposal", () => {
    it.live("InstanceDisposed is delivered to wildcard subscribers before stream ends", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const received: string[] = []
        const seen = yield* Deferred.make<void>()
        const disposed = yield* Deferred.make<void>()

        yield* Effect.gen(function* () {
          const bus = yield* Bus.Service
          yield* bus.subscribeAllCallback((evt) => {
            received.push(evt.type)
            if (evt.type === TestEvent.Ping.type) Deferred.doneUnsafe(seen, Effect.void)
            if (evt.type === Bus.InstanceDisposed.type) Deferred.doneUnsafe(disposed, Effect.void)
          })
          yield* bus.publish(TestEvent.Ping, { value: 1 })
          yield* Deferred.await(seen).pipe(Effect.timeout("2 seconds"))
        }).pipe(provideInstance(tmp))

        yield* Effect.promise(disposeAllInstances)
        yield* Deferred.await(disposed).pipe(Effect.timeout("2 seconds"))

        expect(received).toContain("test.ping")
        expect(received).toContain(Bus.InstanceDisposed.type)
      }),
    )
  })
})
