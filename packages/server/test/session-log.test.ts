import { expect } from "bun:test"
import { Clock, Context, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { Session } from "@opencode/schema/session"
import { it } from "../../core/test/lib/effect"
import { createRoutes } from "../src/routes"

const setup = Effect.fnUntraced(function* (persist?: boolean) {
  const routes = createRoutes({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
    config: { project: false },
    ...(persist === undefined ? {} : { events: { persist } }),
  })
  const context = yield* Layer.build(routes.pipe(Layer.provide(HttpServer.layerServices)))
  // Web handlers run outside the test fiber; carry its clock into the response stream.
  const clock = yield* Clock.Clock
  const handler = Context.get(context, HttpRouter.HttpRouter)
    .asHttpEffect()
    .pipe(HttpEffect.toWebHandlerWith(Context.add(context, Clock.Clock, clock)))
  const response = yield* Effect.promise(() =>
    handler(
      new Request("http://opencode.local/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Log test" }),
      }),
    ),
  )
  expect(response.status).toBe(200)
  const created = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))(
    yield* Effect.promise(() => response.json()),
  )
  return { handler, sessionID: created.data.id }
})

it.live("advertises default persistence off and completes a non-following HTTP log", () =>
  Effect.gen(function* () {
    const server = yield* setup()
    const response = yield* Effect.promise(() =>
      server.handler(
        new Request(`http://opencode.local/api/experimental/session/${server.sessionID}/log?follow=false`),
      ),
    )
    expect(response.status).toBe(200)
    const text = yield* Effect.promise(() => response.text())
    expect(text).toContain('"type":"log.synced"')
    expect(text).toContain('"persist":false')
    expect(text).not.toContain('"type":"session.created"')
    expect(text).not.toContain(": heartbeat")
  }),
)

it.effect("heartbeats a quiet followed log without adding a cursor or data event", () =>
  Effect.gen(function* () {
    const server = yield* setup(true)
    const response = yield* Effect.promise(() =>
      server.handler(
        new Request(`http://opencode.local/api/experimental/session/${server.sessionID}/log?after=0&follow=true`),
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    const body = response.body
    if (!body) return yield* Effect.die("Missing SSE body")
    const reader = yield* Effect.acquireRelease(
      Effect.sync(() => body.getReader()),
      (reader) => Effect.promise(() => reader.cancel()),
    )
    const first = yield* Effect.promise(() => reader.read())
    expect(new TextDecoder().decode(first.value)).toContain('"persist":true')

    const next = yield* Effect.promise(() => reader.read()).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Effect.yieldNow
    expect(next.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("14 seconds")
    expect(next.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 second")
    expect(new TextDecoder().decode((yield* Fiber.join(next)).value)).toBe(": heartbeat\n\n")

    const again = yield* Effect.promise(() => reader.read()).pipe(Effect.forkChild({ startImmediately: true }))
    yield* TestClock.adjust("15 seconds")
    expect(new TextDecoder().decode((yield* Fiber.join(again)).value)).toBe(": heartbeat\n\n")

    const updated = yield* Effect.promise(() =>
      server.handler(
        new Request(`http://opencode.local/api/session/${server.sessionID}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "After heartbeat" }),
        }),
      ),
    )
    expect(updated.status).toBe(204)
    yield* Effect.promise(() => updated.arrayBuffer())
    const event = new TextDecoder().decode((yield* Effect.promise(() => reader.read())).value)
    expect(event).toContain('"type":"session.renamed"')
    expect(event).toContain('"seq":1')
  }),
)

it.live("keeps unknown-session responses as HTTP errors when following", () =>
  Effect.gen(function* () {
    const server = yield* setup()
    const response = yield* Effect.promise(() =>
      server.handler(
        new Request(`http://opencode.local/api/experimental/session/${Session.ID.create()}/log?follow=true`),
      ),
    )
    expect(response.status).toBe(404)
    expect(response.headers.get("content-type")).not.toContain("text/event-stream")
  }),
)
