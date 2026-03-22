import { afterEach, describe, expect, test } from "bun:test"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const TestEvent = {
  Ping: BusEvent.define("test.ping", z.object({ value: z.number() })),
  Pong: BusEvent.define("test.pong", z.object({ message: z.string() })),
}

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
}

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
        // Give the subscriber fiber time to start consuming
        await Bun.sleep(10)
        await Bus.publish(TestEvent.Ping, { value: 42 })
        await Bus.publish(TestEvent.Ping, { value: 99 })
        // Give subscriber time to process
        await Bun.sleep(10)
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
        await Bun.sleep(10)
        await Bus.publish(TestEvent.Pong, { message: "hello" })
        await Bus.publish(TestEvent.Ping, { value: 1 })
        await Bun.sleep(10)
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

  describe("unsubscribe", () => {
    test("unsubscribe stops delivery", async () => {
      await using tmp = await tmpdir()
      const received: number[] = []

      await withInstance(tmp.path, async () => {
        const unsub = Bus.subscribe(TestEvent.Ping, (evt) => {
          received.push(evt.properties.value)
        })
        await Bun.sleep(10)
        await Bus.publish(TestEvent.Ping, { value: 1 })
        await Bun.sleep(10)
        unsub()
        await Bun.sleep(10)
        await Bus.publish(TestEvent.Ping, { value: 2 })
        await Bun.sleep(10)
      })

      expect(received).toEqual([1])
    })
  })

  describe("subscribeAll", () => {
    test("receives all event types", async () => {
      await using tmp = await tmpdir()
      const received: string[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribeAll((evt) => {
          received.push(evt.type)
        })
        await Bun.sleep(10)
        await Bus.publish(TestEvent.Ping, { value: 1 })
        await Bus.publish(TestEvent.Pong, { message: "hi" })
        await Bun.sleep(10)
      })

      expect(received).toContain("test.ping")
      expect(received).toContain("test.pong")
    })
  })

  describe("instance disposal", () => {
    test("InstanceDisposed is delivered to wildcard subscribers before stream ends", async () => {
      await using tmp = await tmpdir()
      const received: string[] = []

      await withInstance(tmp.path, async () => {
        Bus.subscribeAll((evt) => {
          received.push(evt.type)
        })
        await Bun.sleep(10)
        await Bus.publish(TestEvent.Ping, { value: 1 })
        await Bun.sleep(10)
      })

      // Instance.disposeAll triggers the finalizer which publishes InstanceDisposed
      await Instance.disposeAll()
      await Bun.sleep(50)

      expect(received).toContain("test.ping")
      expect(received).toContain(Bus.InstanceDisposed.type)
    })
  })
})
