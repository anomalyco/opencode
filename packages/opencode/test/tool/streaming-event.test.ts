import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { Fiber, Stream } from "effect"
import z from "zod"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import { EventStream } from "../../src/tool/streaming-event"
import { tmpdir } from "../fixture/fixture"

const NumberEvent = BusEvent.define(
  "test.streaming.number",
  z.object({
    value: z.number(),
  }),
)

const onlyNumber = Stream.filter<EventStream.Event>((event) => event.type === NumberEvent.type)

describe("EventStream", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  afterAll(async () => {
    await EventStream.dispose()
  })

  test("fans out one bus event to concurrent subscribers", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stream = await EventStream.eventStream()
        const a = EventStream.runtime.runFork(stream.pipe(onlyNumber, Stream.take(1), Stream.runCollect))
        const b = EventStream.runtime.runFork(stream.pipe(onlyNumber, Stream.take(1), Stream.runCollect))

        await Bun.sleep(10)

        await Bus.publish(NumberEvent, { value: 1 })

        const left = await EventStream.runtime.runPromise(Fiber.join(a))
        const right = await EventStream.runtime.runPromise(Fiber.join(b))

        expect(left).toEqual([{ type: "test.streaming.number", properties: { value: 1 } }])
        expect(right).toEqual([{ type: "test.streaming.number", properties: { value: 1 } }])
      },
    })
  })

  test("reacquires after the last subscriber exits", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stream = await EventStream.eventStream()

        const a = EventStream.runtime.runFork(stream.pipe(onlyNumber, Stream.take(1), Stream.runCollect))
        await Bun.sleep(10)
        await Bus.publish(NumberEvent, { value: 1 })
        expect(await EventStream.runtime.runPromise(Fiber.join(a))).toEqual([
          { type: "test.streaming.number", properties: { value: 1 } },
        ])

        const b = EventStream.runtime.runFork(stream.pipe(onlyNumber, Stream.take(1), Stream.runCollect))
        await Bun.sleep(10)
        await Bus.publish(NumberEvent, { value: 2 })
        expect(await EventStream.runtime.runPromise(Fiber.join(b))).toEqual([
          { type: "test.streaming.number", properties: { value: 2 } },
        ])
      },
    })
  })
})
