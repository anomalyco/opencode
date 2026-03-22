import { afterEach, describe, expect, test } from "bun:test"
import { Deferred, Effect, ManagedRuntime, Stream } from "effect"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { provideInstance, tmpdir } from "../fixture/fixture"

const TestEvent = {
  Ping: BusEvent.define("test.effect.ping", z.object({ value: z.number() })),
  Pong: BusEvent.define("test.effect.pong", z.object({ message: z.string() })),
}

async function runBus<A>(directory: string, self: Effect.Effect<A, never, Bus.Service>) {
  const rt = ManagedRuntime.make(Bus.layer)
  try {
    return await rt.runPromise(self.pipe(provideInstance(directory)))
  } finally {
    await rt.dispose()
  }
}

describe("Bus (Effect-native)", () => {
  afterEach(() => Instance.disposeAll())

  test("publish + subscribe stream delivers events", async () => {
    await using tmp = await tmpdir()

    await runBus(
      tmp.path,
      Effect.scoped(
        Bus.Service.use((bus) =>
          Effect.gen(function* () {
            const received: number[] = []
            const done = yield* Deferred.make<void>()

            yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
              Effect.sync(() => {
                received.push(evt.properties.value)
                if (received.length === 2) Deferred.doneUnsafe(done, Effect.void)
              }),
            ).pipe(Effect.forkScoped)

            yield* Effect.sleep("10 millis")
            yield* bus.publish(TestEvent.Ping, { value: 1 })
            yield* bus.publish(TestEvent.Ping, { value: 2 })
            yield* Deferred.await(done)

            expect(received).toEqual([1, 2])
          }),
        ),
      ),
    )
  })

  test("subscribe filters by event type", async () => {
    await using tmp = await tmpdir()

    await runBus(
      tmp.path,
      Effect.scoped(
        Bus.Service.use((bus) =>
          Effect.gen(function* () {
            const pings: number[] = []
            const done = yield* Deferred.make<void>()

            yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
              Effect.sync(() => {
                pings.push(evt.properties.value)
                Deferred.doneUnsafe(done, Effect.void)
              }),
            ).pipe(Effect.forkScoped)

            yield* Effect.sleep("10 millis")
            yield* bus.publish(TestEvent.Pong, { message: "ignored" })
            yield* bus.publish(TestEvent.Ping, { value: 42 })
            yield* Deferred.await(done)

            expect(pings).toEqual([42])
          }),
        ),
      ),
    )
  })

  test("subscribeAll receives all types", async () => {
    await using tmp = await tmpdir()

    await runBus(
      tmp.path,
      Effect.scoped(
        Bus.Service.use((bus) =>
          Effect.gen(function* () {
            const types: string[] = []
            const done = yield* Deferred.make<void>()

            yield* Stream.runForEach(bus.subscribeAll(), (evt) =>
              Effect.sync(() => {
                types.push(evt.type)
                if (types.length === 2) Deferred.doneUnsafe(done, Effect.void)
              }),
            ).pipe(Effect.forkScoped)

            yield* Effect.sleep("10 millis")
            yield* bus.publish(TestEvent.Ping, { value: 1 })
            yield* bus.publish(TestEvent.Pong, { message: "hi" })
            yield* Deferred.await(done)

            expect(types).toContain("test.effect.ping")
            expect(types).toContain("test.effect.pong")
          }),
        ),
      ),
    )
  })

  test("multiple subscribers each receive the event", async () => {
    await using tmp = await tmpdir()

    await runBus(
      tmp.path,
      Effect.scoped(
        Bus.Service.use((bus) =>
          Effect.gen(function* () {
            const a: number[] = []
            const b: number[] = []
            const doneA = yield* Deferred.make<void>()
            const doneB = yield* Deferred.make<void>()

            yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
              Effect.sync(() => {
                a.push(evt.properties.value)
                Deferred.doneUnsafe(doneA, Effect.void)
              }),
            ).pipe(Effect.forkScoped)

            yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
              Effect.sync(() => {
                b.push(evt.properties.value)
                Deferred.doneUnsafe(doneB, Effect.void)
              }),
            ).pipe(Effect.forkScoped)

            yield* Effect.sleep("10 millis")
            yield* bus.publish(TestEvent.Ping, { value: 99 })
            yield* Deferred.await(doneA)
            yield* Deferred.await(doneB)

            expect(a).toEqual([99])
            expect(b).toEqual([99])
          }),
        ),
      ),
    )
  })
})
