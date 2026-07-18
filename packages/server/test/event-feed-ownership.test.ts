import { describe, expect, test } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Fiber, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { EventFeed } from "../src/event-feed"

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

describe("EventFeed ownership", () => {
  it.effect("canceling a subscriber scope returns diagnostics.active to baseline", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (value) => value.id })
      const baseline = feed.diagnostics().active

      const fiber = yield* Effect.gen(function* () {
        const stream = yield* feed.subscribe()
        expect(feed.diagnostics().active).toBe(baseline + 1)
        yield* stream.pipe(Stream.runCollect)
      }).pipe(Effect.scoped, Effect.forkChild)

      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)
      yield* Fiber.await(fiber)

      expect(feed.diagnostics().active).toBe(baseline)
      expect(feed.diagnostics().opens).toBeGreaterThanOrEqual(1)
      expect(feed.diagnostics().closes).toBeGreaterThanOrEqual(1)
    }),
  )

  test("real network abort closes the response body stream", async () => {
    let closed = false
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        let current: ReadableStreamDefaultController<Uint8Array> | undefined
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            current = controller
            controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","data":{}}\n\n'))
          },
          cancel() {
            closed = true
          },
        })
        request.signal.addEventListener(
          "abort",
          () => {
            closed = true
            try {
              current?.close()
            } catch {
              // already closed by the client disconnect
            }
          },
          { once: true },
        )
        return new Response(stream, { headers: { "content-type": "text/event-stream" } })
      },
    })

    try {
      const controller = new AbortController()
      const response = await fetch(`http://127.0.0.1:${server.port}/api/event`, { signal: controller.signal })
      expect(response.ok).toBe(true)
      const reader = response.body!.getReader()
      await reader.read()
      controller.abort()
      await reader.closed.catch(() => undefined)
      await Bun.sleep(50)
      expect(closed).toBe(true)
    } finally {
      await server.stop(true)
    }
  })

  it.effect("eleven sequential subscribe scopes never accumulate active subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (value) => value.id })

      for (let i = 0; i < 11; i++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* feed.subscribe()
            expect(feed.diagnostics().active).toBe(1)
          }),
        )
        expect(feed.diagnostics().active).toBe(0)
      }

      expect(feed.diagnostics().opens).toBe(11)
      expect(feed.diagnostics().closes).toBe(11)
    }),
  )
})
