import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Effect, Fiber, Layer, ManagedRuntime, Queue, ServiceMap, Stream } from "effect"
import * as readline from "node:readline"
import z from "zod"
import { Log } from "../util/log"

export namespace EventStream {
  const log = Log.create({ service: "streaming-event" })

  export interface Event {
    readonly type: string
    readonly properties: unknown
  }

  export interface Api {
    readonly eventStream: () => Stream.Stream<Event>
  }

  export class Service extends ServiceMap.Service<Service, Api>()("@opencode/EventStream") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      // Bridge callback-based Bus events into a Stream, but only while the
      // shared stream has at least one active consumer.
      const stream = yield* Stream.callback<Event>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            log.info("subscribe all created")
            return Bus.subscribeAll((event) => {
              log.info("event", event)
              Queue.offerUnsafe(queue, event)
            })
          }),
          (unsub) =>
            Effect.sync(() => {
              log.info("subscribe all released")
              unsub()
            }),
        ),
      ).pipe(Stream.share({ capacity: "unbounded" }))

      return Service.of({
        eventStream: () => stream,
      })
    }),
  )

  export const defaultLayer = layer
  export const runtime = ManagedRuntime.make(defaultLayer)

  export function eventStream() {
    return runtime.runPromise(Service.use((svc) => Effect.succeed(svc.eventStream())))
  }

  export function dispose() {
    return runtime.dispose()
  }
}

const NumberEvent = BusEvent.define(
  "test.number",
  z.object({
    value: z.number(),
  }),
)

function consumer(name: string, stream: Stream.Stream<EventStream.Event>) {
  // Each consumer runs independently, but Stream.share ensures they all fan
  // out from a single underlying Bus subscription.
  return EventStream.runtime.runFork(
    stream.pipe(
      Stream.tap((event) => Effect.sync(() => console.log(`[${name}]`, event))),
      Stream.runDrain,
    ),
  )
}

async function main() {
  // The promise API mirrors how this service would be consumed from a server:
  // get a stream once, then attach and detach listeners over time.
  const stream = await EventStream.eventStream()
  const subs = new Map<string, Fiber.Fiber<void, unknown>>()
  let id = 0

  const add = () => {
    id += 1
    const name = `consumer-${id}`
    subs.set(name, consumer(name, stream))
    console.log(`added ${name}`)
  }

  const remove = async () => {
    const name = [...subs.keys()].at(-1)
    if (!name) {
      console.log("no subscribers")
      return
    }
    const fiber = subs.get(name)
    subs.delete(name)
    if (fiber) await EventStream.runtime.runPromise(Fiber.interrupt(fiber))
    console.log(`removed ${name}`)
  }

  add()
  add()

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // `+` and `-` let us verify the subscribe / release logs as the ref-count
  // moves between zero and one-or-more consumers.
  console.log("Commands: '+' add subscriber, '-' remove subscriber, number emit event, 'q' quit.")

  try {
    await new Promise<void>((resolve) => {
      rl.on("line", async (line) => {
        const text = line.trim()
        if (text === "q") {
          rl.close()
          resolve()
          return
        }
        if (text === "+") {
          add()
          return
        }
        if (text === "-") {
          await remove()
          return
        }

        const value = Number(text)
        if (Number.isNaN(value)) {
          console.log("use '+', '-', a number, or 'q'")
          return
        }

        await Bus.publish(NumberEvent, { value })
      })

      rl.on("close", () => {
        resolve()
      })
    })
  } finally {
    await Promise.all([...subs.values()].map((fiber) => EventStream.runtime.runPromise(Fiber.interrupt(fiber))))
    await EventStream.dispose()
  }
}

if (import.meta.main) {
  void Instance.provide({
    directory: process.cwd(),
    fn: () => main(),
  }).catch(console.error)
}
