import { describe, expect } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { DateTime, Effect, Fiber, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { EventFeed } from "../src/event-feed"

const Clients = [1, 2, 4, 8, 11, 16] as const
const Sizes = {
  small: 1 * 1024,
  medium: 64 * 1024,
  large: 256 * 1024,
} as const

function makeSource() {
  let subscriber: EventV2.Subscriber | undefined
  return {
    observe: (next: EventV2.Subscriber) =>
      Effect.sync(() => {
        subscriber = next
        return Effect.sync(() => {
          if (subscriber === next) subscriber = undefined
        })
      }),
    publish: (event: EventV2.Payload) => Effect.suspend(() => (subscriber ? subscriber(event) : Effect.void)),
  }
}

function sessionEvent(id: string, sessionID: string, location: { directory: string }): EventV2.Payload {
  return {
    id: EventV2.ID.make(`evt_${id}`),
    created: DateTime.makeUnsafe(Date.now()),
    type: "session.renamed",
    data: { sessionID, title: id },
    durable: { aggregateID: sessionID, seq: EventV2.Seq.make(1), version: EventV2.Version.make(1) },
    location: {
      directory: AbsolutePath.make(location.directory),
    },
  }
}

function eventLoopDelayMs() {
  const start = performance.now()
  return new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - start), 0)
  })
}

type Row = {
  clients: number
  size: keyof typeof Sizes
  payloadBytes: number
  interested: number
  serializedEvents: number
  serializedBytes: number
  peakActive: number
  receivedInterested: number
  receivedUninterested: number
  publishMs: number
  clientHandleMs: number
  rssBefore: number
  rssAfter: number
  eventLoopDelayMs: number
}

describe("EventFeed fan-out benchmark", () => {
  it.live(
    "accounting laws hold across client counts and payload sizes",
    () =>
      Effect.gen(function* () {
        const rows: Row[] = []

        for (const clients of Clients) {
          for (const size of Object.keys(Sizes) as Array<keyof typeof Sizes>) {
            rows.push(yield* measureCell(clients, size))
          }
        }

        // Same payload class → same serialized byte cost regardless of uninterested N.
        for (const size of Object.keys(Sizes) as Array<keyof typeof Sizes>) {
          const bytes = rows.filter((row) => row.size === size).map((row) => row.serializedBytes)
          expect(new Set(bytes).size).toBe(1)
          expect(bytes[0]).toBe(Sizes[size])
        }

        // Encode-once: every cell accepted exactly one hot publish.
        expect(rows.every((row) => row.serializedEvents === 1)).toBe(true)

        console.log(JSON.stringify({ benchmark: "event-feed-fanout", rows }, null, 2))
      }),
    60_000,
  )
})

function measureCell(clients: number, size: keyof typeof Sizes) {
  const payloadBytes = Sizes[size]
  const interested = Math.max(1, Math.floor(clients / 2))
  const frame = "x".repeat(payloadBytes)

  return Effect.scoped(
    Effect.gen(function* () {
      let serializedEvents = 0
      let serializedBytes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: () => {
          serializedEvents += 1
          serializedBytes += Buffer.byteLength(frame, "utf-8")
          return frame
        },
      })

      const received = Array.from({ length: clients }, () => 0)
      const fibers: Array<Fiber.Fiber<void, EventFeed.Error>> = []

      for (let index = 0; index < clients; index++) {
        const sessions = index < interested ? ["ses_hot"] : [`ses_${index}`]
        const stream = yield* feed.subscribe({
          location: { directory: "/tmp/project" },
          sessions,
        })
        fibers.push(
          yield* stream.pipe(
            Stream.take(1),
            Stream.runForEach(() => Effect.sync(() => (received[index] += 1))),
            Effect.forkScoped,
          ),
        )
      }

      const rssBefore = process.memoryUsage().rss
      const loopDelay = yield* Effect.promise(eventLoopDelayMs)
      const publishStarted = performance.now()
      yield* source.publish(sessionEvent("hot", "ses_hot", { directory: "/tmp/project" }))
      const publishMs = performance.now() - publishStarted

      const handleStarted = performance.now()
      for (const fiber of fibers.slice(0, interested)) yield* Fiber.join(fiber)
      const clientHandleMs = performance.now() - handleStarted

      for (const fiber of fibers.slice(interested)) yield* Fiber.interrupt(fiber)

      expect(serializedEvents).toBe(1)
      expect(serializedBytes).toBe(payloadBytes)
      expect(received.slice(0, interested).every((count) => count === 1)).toBe(true)
      expect(received.slice(interested).every((count) => count === 0)).toBe(true)

      return {
        clients,
        size,
        payloadBytes,
        interested,
        serializedEvents,
        serializedBytes,
        peakActive: clients,
        receivedInterested: received.slice(0, interested).reduce((sum, count) => sum + count, 0),
        receivedUninterested: received.slice(interested).reduce((sum, count) => sum + count, 0),
        publishMs,
        clientHandleMs,
        rssBefore,
        rssAfter: process.memoryUsage().rss,
        eventLoopDelayMs: loopDelay,
      } satisfies Row
    }),
  )
}
