import { NodeHttpServer } from "@effect/platform-node"
import { EventV2 } from "@opencode-ai/core/event"
import { describe, expect } from "bun:test"
import { Context, Effect, Fiber, Layer, Stream } from "effect"
import { HttpServer, HttpServerRequest } from "effect/unstable/http"
import { createServer } from "node:http"
import { it } from "../../core/test/lib/effect"
import { EventFeed } from "../src/event-feed"
import { subscribeResponse } from "../src/handlers/event"

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

async function wait(fn: () => boolean, timeout = 3000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
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

  it.live(
    "aborting a real Node HTTP client returns EventFeed.active to baseline",
    () =>
      Effect.gen(function* () {
        const source = makeSource()
        const feed = yield* EventFeed.make(source.observe)
        const baseline = feed.diagnostics().active

        const context = yield* Layer.build(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: 0 }))
        const server = Context.get(context, HttpServer.HttpServer)
        yield* server
          .serve(HttpServerRequest.HttpServerRequest.use((request) => subscribeResponse(feed, request, {})))
          .pipe(Effect.forkScoped)

        const base = HttpServer.formatAddress(server.address)
        const controller = new AbortController()
        const response = yield* Effect.promise(() => fetch(`${base}/api/event`, { signal: controller.signal }))
        expect(response.ok).toBe(true)
        expect(response.body).toBeDefined()
        const reader = response.body?.getReader()
        expect(reader).toBeDefined()
        if (!reader) throw new Error("expected event stream body reader")

        yield* Effect.promise(() => reader.read())
        expect(feed.diagnostics().active).toBe(baseline + 1)

        controller.abort()
        // Bun may never settle `reader.closed` after abort; cancel and watch feed release.
        yield* Effect.promise(() => reader.cancel().catch(() => undefined))
        yield* Effect.promise(() => wait(() => feed.diagnostics().active === baseline))

        expect(feed.diagnostics().active).toBe(baseline)
        expect(feed.diagnostics().closes).toBeGreaterThanOrEqual(1)
        const dump = JSON.stringify(feed.diagnostics())
        expect(dump.includes("payload")).toBe(false)
      }),
    15_000,
  )

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
