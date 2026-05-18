import { afterEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const TestEvent = BusEvent.define("test.integration", Schema.Struct({ value: Schema.Number }))

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
}

describe("Bus integration: acquireRelease subscriber pattern", () => {
  afterEach(() => Instance.disposeAll())

  test("subscriber via callback facade receives events and cleans up on unsub", async () => {
    await using tmp = await tmpdir()
    const received: number[] = []

    await withInstance(tmp.path, async () => {
      const unsub = Bus.subscribe(TestEvent, (evt) => {
        received.push(evt.properties.value)
      })
      await Bun.sleep(10)
      await Bus.publish(TestEvent, { value: 1 })
      await Bus.publish(TestEvent, { value: 2 })
      await Bun.sleep(10)

      expect(received).toEqual([1, 2])

      unsub()
      await Bun.sleep(10)
      await Bus.publish(TestEvent, { value: 3 })
      await Bun.sleep(10)

      expect(received).toEqual([1, 2])
    })
  })

  test("subscribeAll receives events from multiple types", async () => {
    await using tmp = await tmpdir()
    const received: Array<{ type: string; value?: number }> = []

    const OtherEvent = BusEvent.define("test.other", Schema.Struct({ value: Schema.Number }))

    await withInstance(tmp.path, async () => {
      Bus.subscribeAll((evt) => {
        received.push({ type: evt.type, value: evt.properties.value })
      })
      await Bun.sleep(10)
      await Bus.publish(TestEvent, { value: 10 })
      await Bus.publish(OtherEvent, { value: 20 })
      await Bun.sleep(10)
    })

    expect(received).toEqual([
      { type: "test.integration", value: 10 },
      { type: "test.other", value: 20 },
    ])
  })

  test("subscriber cleanup on instance disposal interrupts the stream", async () => {
    await using tmp = await tmpdir()
    const received: number[] = []
    let disposed = false

    await withInstance(tmp.path, async () => {
      Bus.subscribeAll((evt) => {
        if (evt.type === Bus.InstanceDisposed.type) {
          disposed = true
          return
        }
        received.push(evt.properties.value)
      })
      await Bun.sleep(10)
      await Bus.publish(TestEvent, { value: 1 })
      await Bun.sleep(10)
    })

    await Instance.disposeAll()
    await Bun.sleep(50)

    expect(received).toEqual([1])
    expect(disposed).toBe(true)
  })
})
