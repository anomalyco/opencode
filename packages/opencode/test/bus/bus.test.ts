import { afterEach, describe, expect, test } from "bun:test"
import { Deferred, Effect, Stream } from "effect"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { GlobalBus } from "../../src/bus/global"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// Test event definitions
// ---------------------------------------------------------------------------

const TestEvent = {
  Ping: BusEvent.define("test.ping", z.object({ value: z.number() })),
  Pong: BusEvent.define("test.pong", z.object({ message: z.string() })),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Bus", () => {
  afterEach(() => Instance.disposeAll())

  describe("publish + subscribe", () => {
    test("subscriber receives matching events", async () => {
      await using tmp = await tmpdir()
      const received: number[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribe(TestEvent.Ping, (evt) => {
          received.push(evt.properties.value)
        })
        await Bus.publish(TestEvent.Ping, { value: 42 })
        await Bus.publish(TestEvent.Ping, { value: 99 })
      })

      expect(received).toEqual([42, 99])
    })

    test("subscriber does not receive events of other types", async () => {
      await using tmp = await tmpdir()
      const pings: number[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribe(TestEvent.Ping, (evt) => {
          pings.push(evt.properties.value)
        })
        await Bus.publish(TestEvent.Pong, { message: "hello" })
        await Bus.publish(TestEvent.Ping, { value: 1 })
      })

      expect(pings).toEqual([1])
    })

    test("publish with no subscribers does not throw", async () => {
      await using tmp = await tmpdir()

      await withInstance(tmp.path, async () => {
        await Bus.publish(TestEvent.Ping, { value: 1 })
      })
    })
  })

  describe("multiple subscribers", () => {
    test("all subscribers for same event type are called", async () => {
      await using tmp = await tmpdir()
      const a: number[] = []
      const b: number[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribe(TestEvent.Ping, (evt) => a.push(evt.properties.value))
        Bus.subscribe(TestEvent.Ping, (evt) => b.push(evt.properties.value))
        await Bus.publish(TestEvent.Ping, { value: 7 })
      })

      expect(a).toEqual([7])
      expect(b).toEqual([7])
    })

    test("subscribers are called in registration order", async () => {
      await using tmp = await tmpdir()
      const order: string[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribe(TestEvent.Ping, () => order.push("first"))
        Bus.subscribe(TestEvent.Ping, () => order.push("second"))
        Bus.subscribe(TestEvent.Ping, () => order.push("third"))
        await Bus.publish(TestEvent.Ping, { value: 0 })
      })

      expect(order).toEqual(["first", "second", "third"])
    })
  })

  describe("unsubscribe", () => {
    test("unsubscribe stops delivery", async () => {
      await using tmp = await tmpdir()
      const received: number[] = []

      await withInstance(tmp.path, async () => {
        const unsub = Bus.subscribe(TestEvent.Ping, (evt) => {
          received.push(evt.properties.value)
        })
        await Bus.publish(TestEvent.Ping, { value: 1 })
        unsub()
        await Bus.publish(TestEvent.Ping, { value: 2 })
      })

      expect(received).toEqual([1])
    })

    test("unsubscribe is idempotent", async () => {
      await using tmp = await tmpdir()

      await withInstance(tmp.path, async () => {
        const unsub = Bus.subscribe(TestEvent.Ping, () => {})
        unsub()
        unsub() // should not throw
      })
    })

    test("unsubscribing one does not affect others", async () => {
      await using tmp = await tmpdir()
      const a: number[] = []
      const b: number[] = []

      await withInstance(tmp.path, async () => {
        const unsubA = Bus.subscribe(TestEvent.Ping, (evt) => a.push(evt.properties.value))
        Bus.subscribe(TestEvent.Ping, (evt) => b.push(evt.properties.value))
        await Bus.publish(TestEvent.Ping, { value: 1 })
        unsubA()
        await Bus.publish(TestEvent.Ping, { value: 2 })
      })

      expect(a).toEqual([1])
      expect(b).toEqual([1, 2])
    })
  })

  describe("subscribeAll", () => {
    test("receives events of all types", async () => {
      await using tmp = await tmpdir()
      const all: string[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribeAll((evt) => {
          all.push(evt.type)
        })
        await Bus.publish(TestEvent.Ping, { value: 1 })
        await Bus.publish(TestEvent.Pong, { message: "hi" })
      })

      expect(all).toEqual(["test.ping", "test.pong"])
    })

    test("subscribeAll + typed subscribe both fire", async () => {
      await using tmp = await tmpdir()
      const typed: number[] = []
      const wild: string[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribe(TestEvent.Ping, (evt) => typed.push(evt.properties.value))
        Bus.subscribeAll((evt) => wild.push(evt.type))
        await Bus.publish(TestEvent.Ping, { value: 5 })
      })

      expect(typed).toEqual([5])
      expect(wild).toEqual(["test.ping"])
    })

    test("unsubscribe from subscribeAll", async () => {
      await using tmp = await tmpdir()
      const all: string[] = []

      await withInstance(tmp.path, async () => {
        const unsub = Bus.subscribeAll((evt) => all.push(evt.type))
        await Bus.publish(TestEvent.Ping, { value: 1 })
        unsub()
        await Bus.publish(TestEvent.Pong, { message: "missed" })
      })

      expect(all).toEqual(["test.ping"])
    })

    test("subscribeAll delivers InstanceDisposed on disposal", async () => {
      await using tmp = await tmpdir()
      const all: string[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribeAll((evt) => {
          all.push(evt.type)
        })
        await Bus.publish(TestEvent.Ping, { value: 1 })
      })

      await Instance.disposeAll()

      expect(all).toContain("test.ping")
      expect(all).toContain(Bus.InstanceDisposed.type)
    })

    test("manual unsubscribe suppresses InstanceDisposed", async () => {
      await using tmp = await tmpdir()
      const all: string[] = []
      let unsub = () => {}

      await withInstance(tmp.path, async () => {
        unsub = Bus.subscribeAll((evt) => {
          all.push(evt.type)
        })
      })

      unsub()
      await Instance.disposeAll()

      expect(all).not.toContain(Bus.InstanceDisposed.type)
    })
  })

  describe("GlobalBus forwarding", () => {
    test("publish emits to GlobalBus with directory", async () => {
      await using tmp = await tmpdir()
      const globalEvents: Array<{ directory?: string; payload: any }> = []

      const handler = (evt: any) => globalEvents.push(evt)
      GlobalBus.on("event", handler)

      try {
        await withInstance(tmp.path, async () => {
          await Bus.publish(TestEvent.Ping, { value: 42 })
        })

        const ping = globalEvents.find((e) => e.payload.type === "test.ping")
        expect(ping).toBeDefined()
        expect(ping!.directory).toBe(tmp.path)
        expect(ping!.payload).toEqual({
          type: "test.ping",
          properties: { value: 42 },
        })
      } finally {
        GlobalBus.off("event", handler)
      }
    })
  })

  describe("instance isolation", () => {
    test("subscribers in one instance do not receive events from another", async () => {
      await using tmpA = await tmpdir()
      await using tmpB = await tmpdir()
      const eventsA: number[] = []
      const eventsB: number[] = []

      await withInstance(tmpA.path, async () => {
        Bus.subscribe(TestEvent.Ping, (evt) => eventsA.push(evt.properties.value))
      })

      await withInstance(tmpB.path, async () => {
        Bus.subscribe(TestEvent.Ping, (evt) => eventsB.push(evt.properties.value))
      })

      await withInstance(tmpA.path, async () => {
        await Bus.publish(TestEvent.Ping, { value: 1 })
      })

      await withInstance(tmpB.path, async () => {
        await Bus.publish(TestEvent.Ping, { value: 2 })
      })

      expect(eventsA).toEqual([1])
      expect(eventsB).toEqual([2])
    })
  })


  describe("async subscribers", () => {
    test("publish is fire-and-forget (does not await subscriber callbacks)", async () => {
      await using tmp = await tmpdir()
      const received: number[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribe(TestEvent.Ping, async (evt) => {
          await new Promise((r) => setTimeout(r, 10))
          received.push(evt.properties.value)
        })

        await Bus.publish(TestEvent.Ping, { value: 1 })
        // Give the async subscriber time to complete
        await new Promise((r) => setTimeout(r, 50))
      })

      expect(received).toEqual([1])
    })
  })

  describe("Effect service", () => {
    test("subscribeAll stream receives published events", async () => {
      await using tmp = await tmpdir()
      const received: string[] = []

      await withInstance(tmp.path, () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const svc = yield* Bus.Service
              const done = yield* Deferred.make<void>()
              let count = 0

              yield* Effect.forkScoped(
                svc.subscribeAll().pipe(
                  Stream.runForEach((msg) =>
                    Effect.gen(function* () {
                      received.push(msg.type)
                      if (++count >= 2) yield* Deferred.succeed(done, undefined)
                    }),
                  ),
                ),
              )

              // Let the forked fiber start and subscribe to the PubSub
              yield* Effect.yieldNow

              yield* svc.publish(TestEvent.Ping, { value: 1 })
              yield* svc.publish(TestEvent.Pong, { message: "hi" })
              yield* Deferred.await(done)
            }),
          ).pipe(Effect.provide(Bus.layer)),
        ),
      )

      expect(received).toEqual(["test.ping", "test.pong"])
    })

    test("subscribeAll stream ends with ensuring when scope closes", async () => {
      await using tmp = await tmpdir()
      let ensuringFired = false

      await withInstance(tmp.path, () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const svc = yield* Bus.Service

              yield* Effect.forkScoped(
                svc.subscribeAll().pipe(
                  Stream.runForEach(() => Effect.void),
                  Effect.ensuring(Effect.sync(() => {
                    ensuringFired = true
                  })),
                ),
              )

              yield* svc.publish(TestEvent.Ping, { value: 1 })
              yield* Effect.yieldNow
            }),
          ).pipe(Effect.provide(Bus.layer)),
        ),
      )

      expect(ensuringFired).toBe(true)
    })
  })
})
