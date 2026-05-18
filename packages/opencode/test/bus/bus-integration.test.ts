import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { afterEach, describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Schema } from "effect"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const TestEvent = BusEvent.define("test.integration", Schema.Struct({ value: Schema.Number }))
const it = testEffect(Layer.mergeAll(Bus.layer, CrossSpawnSpawner.defaultLayer))

describe("Bus integration: acquireRelease subscriber pattern", () => {
  afterEach(() => disposeAllInstances())

  it.instance("subscriber via callback facade receives events and cleans up on unsub", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received: number[] = []
      const receivedTwo = yield* Deferred.make<void>()

      const unsub = yield* bus.subscribeCallback(TestEvent, (evt) => {
        received.push(evt.properties.value)
        if (received.length === 2) Deferred.doneUnsafe(receivedTwo, Effect.void)
      })
      yield* bus.publish(TestEvent, { value: 1 })
      yield* bus.publish(TestEvent, { value: 2 })
      yield* Deferred.await(receivedTwo).pipe(Effect.timeout("2 seconds"))

      expect(received).toEqual([1, 2])

      yield* Effect.sync(unsub)
      yield* bus.publish(TestEvent, { value: 3 })
      yield* Effect.sleep("10 millis")

      expect(received).toEqual([1, 2])
    }),
  )

  it.instance("subscribeAll receives events from multiple types", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const received: Array<{ type: string; value?: number }> = []
      const OtherEvent = BusEvent.define("test.other", Schema.Struct({ value: Schema.Number }))
      const receivedTwo = yield* Deferred.make<void>()

      yield* bus.subscribeAllCallback((evt) => {
        received.push({ type: evt.type, value: evt.properties.value })
        if (received.length === 2) Deferred.doneUnsafe(receivedTwo, Effect.void)
      })
      yield* bus.publish(TestEvent, { value: 10 })
      yield* bus.publish(OtherEvent, { value: 20 })
      yield* Deferred.await(receivedTwo).pipe(Effect.timeout("2 seconds"))

      expect(received).toEqual([
        { type: "test.integration", value: 10 },
        { type: "test.other", value: 20 },
      ])
    }),
  )

  it.live("subscriber cleanup on instance disposal interrupts the stream", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const received: number[] = []
      const seen = yield* Deferred.make<void>()
      const disposed = yield* Deferred.make<void>()

      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        yield* bus.subscribeAllCallback((evt) => {
          if (evt.type === Bus.InstanceDisposed.type) {
            Deferred.doneUnsafe(disposed, Effect.void)
            return
          }
          received.push(evt.properties.value)
          Deferred.doneUnsafe(seen, Effect.void)
        })
        yield* bus.publish(TestEvent, { value: 1 })
        yield* Deferred.await(seen).pipe(Effect.timeout("2 seconds"))
      }).pipe(provideInstance(dir))

      yield* Effect.promise(() => disposeAllInstances())
      yield* Deferred.await(disposed).pipe(Effect.timeout("2 seconds"))

      expect(received).toEqual([1])
    }),
  )
})
