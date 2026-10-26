import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Authorization } from "@opencode/protocol/middleware/authorization"
import { Credential } from "@opencode/schema/credential"
import { Event } from "@opencode/schema/event"
import { IntegrationID } from "@opencode/schema/integration-id"
import { Permission } from "@opencode/schema/permission"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http"
import { HttpApi, HttpApiBuilder } from "effect/http-api"
import { createBrotliDecompress, createGunzip } from "node:zlib"
import { it } from "../../core/test/lib/effect"
import { EventGroup } from "@opencode/protocol/groups/event"
import { EventFeed } from "../src/event-feed"
import { EventHandler, isLocalEventClient, negotiateEventEncoding } from "../src/handlers/event"
import { schemaErrorLayer } from "../src/middleware/schema-error"

const EventApi = HttpApi.make("server").add(EventGroup)

const Internal = Bus.ephemeral({ type: "test.internal", schema: { value: Schema.String } })

const event = (id: string): Event.Payload<typeof Agent.Event.Updated> => ({
  id: Event.ID.make(`evt_${id}`),
  created: Date.now(),
  type: Agent.Event.Updated.type,
  data: {},
})

const internal = (value: string): Event.Payload<typeof Internal> => ({
  id: Event.ID.create(),
  created: Date.now(),
  type: Internal.type,
  data: { value },
})

function makeSource() {
  let subscriber: Bus.Subscriber | undefined
  return {
    observe: (next: Bus.Subscriber) =>
      Effect.sync(() => {
        subscriber = next
        return Effect.sync(() => {
          if (subscriber === next) subscriber = undefined
        })
      }),
    publish: (event: Event.Payload) => Effect.suspend(() => (subscriber ? subscriber(event) : Effect.void)),
  }
}

describe("EventFeed", () => {
  test("preserves the public SSE frame encoding", () => {
    const payload = event("wire")
    expect(EventFeed.frame(payload)).toBe(`data: ${JSON.stringify(payload)}\n\n`)
  })

  it.effect("encodes once and delivers the same frame to every subscriber", () =>
    Effect.gen(function* () {
      let encodes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          encodes += 1
          return event.type
        },
      })
      const first = yield* feed.subscribe()
      const second = yield* feed.subscribe()
      const left = yield* first.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const right = yield* second.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(event("example"))

      expect([Array.from(yield* Fiber.join(left)), Array.from(yield* Fiber.join(right))]).toEqual([
        [Agent.Event.Updated.type],
        [Agent.Event.Updated.type],
      ])
      expect(encodes).toBe(1)
    }),
  )

  it.effect("delivers only the requested event types to filtered subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => event.type })
      const filtered = yield* feed.subscribe([Credential.Event.Switched.type])
      const all = yield* feed.subscribe()
      const left = yield* filtered.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const right = yield* all.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)

      yield* source.publish(event("ignored"))
      yield* source.publish({
        id: Event.ID.create(),
        created: Date.now(),
        type: Credential.Event.Switched.type,
        data: {
          credentialID: Credential.ID.make("cred_test"),
          integrationID: IntegrationID.make("openai"),
        },
      })

      expect(Array.from(yield* Fiber.join(left))).toEqual([Credential.Event.Switched.type])
      expect(Array.from(yield* Fiber.join(right))).toEqual([Agent.Event.Updated.type, Credential.Event.Switched.type])
    }),
  )

  it.effect("fails only the subscriber that exceeds its lag capacity", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        capacity: 1,
        encode: (event) => event.id,
      })
      const slow = yield* feed.subscribe()
      const fast = yield* feed.subscribe()
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const received = new Array<string>()
      const fastFiber = yield* fast.pipe(
        Stream.take(3),
        Stream.runForEach((frame) =>
          Effect.sync(() => received.push(frame)).pipe(
            Effect.andThen(
              frame === "evt_one"
                ? Deferred.succeed(first, undefined)
                : frame === "evt_two"
                  ? Deferred.succeed(second, undefined)
                  : Effect.void,
            ),
          ),
        ),
        Effect.forkScoped,
      )

      yield* source.publish(event("one"))
      yield* Deferred.await(first)
      yield* source.publish(event("two"))
      yield* Deferred.await(second)
      yield* source.publish(event("three"))

      yield* Fiber.join(fastFiber)

      const result = yield* slow.pipe(Stream.runCollect, Effect.exit)
      expect(received).toEqual(["evt_one", "evt_two", "evt_three"])
      expect(Exit.isFailure(result)).toBeTrue()
      if (Exit.isSuccess(result)) return
      expect(Option.getOrUndefined(Exit.findErrorOption(result))).toBeInstanceOf(EventFeed.SubscriberOverflowError)
    }),
  )

  it.effect("delivers global credential events to public subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { encode: (event) => event.type })
      const stream = yield* feed.subscribe()
      const received = yield* stream.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)

      yield* source.publish({
        id: Event.ID.create(),
        created: Date.now(),
        type: Credential.Event.Switched.type,
        data: {
          credentialID: Credential.ID.make("cred_test"),
          integrationID: IntegrationID.make("openai"),
        },
      })

      expect(Array.from(yield* Fiber.join(received))).toEqual([Credential.Event.Switched.type])
    }),
  )

  it.effect("filters internal events before they consume subscriber capacity", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, { capacity: 1, encode: (event) => event.type })
      const stream = yield* feed.subscribe()

      yield* source.publish(internal("one"))
      yield* source.publish(internal("two"))
      yield* source.publish(event("public"))

      expect(Array.from(yield* stream.pipe(Stream.take(1), Stream.runCollect))).toEqual([Agent.Event.Updated.type])
    }),
  )

  it.effect("disconnects current subscribers after an encoding failure and continues for later subscribers", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (event) => {
          if (event.id === Event.ID.make("evt_bad")) throw new Error("invalid event")
          return event.id
        },
      })
      const current = yield* feed.subscribe()
      const failed = yield* current.pipe(Stream.runCollect, Effect.exit, Effect.forkScoped)

      yield* source.publish(event("bad"))
      const exit = yield* Fiber.join(failed)

      const next = yield* feed.subscribe()
      const received = yield* next.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* source.publish(event("good"))

      expect(Exit.isFailure(exit)).toBeTrue()
      if (Exit.isSuccess(exit)) return
      expect(Option.getOrUndefined(Exit.findErrorOption(exit))).toBeInstanceOf(EventFeed.EncodingError)
      expect(Array.from(yield* Fiber.join(received))).toEqual(["evt_good"])
    }),
  )

  it.effect("filters detail events to subscribed sessions while delivering summary events to every connection", () =>
    Effect.gen(function* () {
      let encodes = 0
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe, {
        encode: (item) => {
          encodes += 1
          return item.id
        },
      })
      const all = yield* feed.connect()
      const scopedScope = yield* Scope.make()
      const scoped = yield* feed.connect({ detail: "subscribed" }).pipe(Scope.provide(scopedScope))
      const sessionA = Session.ID.make("ses_a")
      const sessionB = Session.ID.make("ses_b")
      const assistantID = SessionMessage.ID.make("msg_assistant")

      const detailEvent = (id: string, sessionID: Session.ID): Event.Payload<typeof SessionEvent.Text.Delta> => ({
        id: Event.ID.make(id),
        created: Date.now(),
        type: SessionEvent.Text.Delta.type,
        data: { sessionID, assistantMessageID: assistantID, ordinal: 0, delta: "chunk" },
      })

      const summaryEvent = (id: string, sessionID: Session.ID): Event.Payload<typeof SessionEvent.Renamed> => ({
        id: Event.ID.make(id),
        created: Date.now(),
        type: SessionEvent.Renamed.type,
        durable: { aggregateID: sessionID, seq: Event.Seq.make(1), version: Event.Version.make(1) },
        data: { sessionID, title: "Renamed" },
      })

      const permissionEvent = (id: string, sessionID: Session.ID): Event.Payload<typeof Permission.Event.Asked> => ({
        id: Event.ID.make(id),
        created: Date.now(),
        type: Permission.Event.Asked.type,
        data: {
          id: Permission.ID.make("per_1"),
          sessionID,
          action: "bash",
          resources: ["ls"],
        },
      })

      // Before subscribing: detail events are dropped for `scoped` without consuming queue capacity,
      // while summary events for any session are delivered.
      yield* source.publish(detailEvent("evt_detail_a_unsubscribed", sessionA))
      yield* source.publish(summaryEvent("evt_summary_b", sessionB))
      yield* source.publish(permissionEvent("evt_perm_b", sessionB))

      // Subscribe to sessionA, then replace the subscription set with sessionB.
      expect(yield* feed.setSessions(scoped.id, [sessionA])).toBe(true)
      yield* source.publish(detailEvent("evt_detail_a_subscribed", sessionA))
      yield* source.publish(detailEvent("evt_detail_b_unsubscribed", sessionB))

      expect(yield* feed.setSessions(scoped.id, [sessionB])).toBe(true)
      yield* source.publish(detailEvent("evt_detail_a_after_replace", sessionA))
      yield* source.publish(detailEvent("evt_detail_b_subscribed", sessionB))

      expect(Array.from(yield* scoped.stream.pipe(Stream.take(4), Stream.runCollect))).toEqual([
        "evt_summary_b",
        "evt_perm_b",
        "evt_detail_a_subscribed",
        "evt_detail_b_subscribed",
      ])
      expect(Array.from(yield* all.stream.pipe(Stream.take(7), Stream.runCollect))).toEqual([
        "evt_detail_a_unsubscribed",
        "evt_summary_b",
        "evt_perm_b",
        "evt_detail_a_subscribed",
        "evt_detail_b_unsubscribed",
        "evt_detail_a_after_replace",
        "evt_detail_b_subscribed",
      ])
      expect(encodes).toBe(7)

      // Closing the connection scope removes its subscription state.
      yield* Scope.close(scopedScope, Exit.void)
      expect(yield* feed.setSessions(scoped.id, [sessionA])).toBe(false)
      expect(yield* feed.setSessions("conn_unknown", [sessionA])).toBe(false)
    }),
  )

  it.live("serves experimental subscribed event streams and returns 404 for unknown or closed connections", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe)
      const webHandler = HttpRouter.toWebHandler(
        HttpApiBuilder.layer(EventApi).pipe(
          Layer.provide(EventHandler),
          Layer.provide(Layer.succeed(EventFeed.Service, feed)),
          Layer.provide(schemaErrorLayer),
          Layer.provide(
            Layer.succeed(
              Authorization,
              Authorization.of((effect) => effect),
            ),
          ),
          Layer.provide(HttpServer.layerServices),
        ),
      ).handler

      const api = OpenCode.make({
        baseUrl: "http://opencode.local",
        fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => webHandler(new Request(input, init)), {
          preconnect: fetch.preconnect,
        }),
      })

      const unknownResponse = yield* Effect.promise(() =>
        webHandler(
          new Request("http://opencode.local/api/experimental/event/missing-connection/sessions", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessions: ["ses_a"] }),
          }),
        ),
      )
      expect(unknownResponse.status).toBe(404)

      const abort = new AbortController()
      const iterator = api.event.experimental
        .subscribe({ detail: "subscribed" }, { signal: abort.signal })
        [Symbol.asyncIterator]()

      const first = yield* Effect.promise(() => iterator.next())
      expect(first.done).toBe(false)
      if (first.done || first.value.type !== "server.connected") throw new Error("Expected server.connected")
      const connectionID = first.value.data.connection
      expect(typeof connectionID).toBe("string")
      if (!connectionID) return

      yield* Effect.promise(() =>
        api.event.experimental.sessions({
          connection: connectionID,
          sessions: [Session.ID.make("ses_subscribed")],
        }),
      )

      yield* source.publish({
        id: Event.ID.make("evt_drop"),
        created: Date.now(),
        type: SessionEvent.Text.Delta.type,
        data: {
          sessionID: Session.ID.make("ses_other"),
          assistantMessageID: SessionMessage.ID.make("msg_1"),
          ordinal: 0,
          delta: "ignored",
        },
      })
      yield* source.publish({
        id: Event.ID.make("evt_keep"),
        created: Date.now(),
        type: SessionEvent.Text.Delta.type,
        data: {
          sessionID: Session.ID.make("ses_subscribed"),
          assistantMessageID: SessionMessage.ID.make("msg_1"),
          ordinal: 0,
          delta: "kept",
        },
      })

      const second = yield* Effect.promise(() => iterator.next())
      expect(second.done).toBe(false)
      if (!second.done) expect(second.value.id).toBe(Event.ID.make("evt_keep"))

      abort.abort()
      yield* Effect.promise(async () => {
        await iterator.return?.()
      })

      const afterClose = yield* Effect.promise(() =>
        webHandler(
          new Request(`http://opencode.local/api/experimental/event/${connectionID}/sessions`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessions: ["ses_subscribed"] }),
          }),
        ),
      )
      expect(afterClose.status).toBe(404)
    }),
  )

  test("negotiates gzip or br for remote event streams and skips local loopback clients unless proxied", () => {
    const makeRequest = (headers: Record<string, string>, remoteAddress?: string) =>
      HttpServerRequest.fromWeb(new Request("http://opencode.local/api/experimental/event", { headers })).modify({
        remoteAddress: Option.fromNullishOr(remoteAddress),
      })

    expect(negotiateEventEncoding(makeRequest({}, "100.64.0.2"))).toBeUndefined()
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "gzip" }, "100.64.0.2"))).toBe("gzip")
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "br" }, "100.64.0.2"))).toBe("br")
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "gzip, deflate, br" }, "100.64.0.2"))).toBe("gzip")
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "br;q=1, gzip;q=0.5" }, "100.64.0.2"))).toBe("br")
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "gzip;q=0" }, "100.64.0.2"))).toBeUndefined()
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "deflate" }, "100.64.0.2"))).toBeUndefined()

    // Loopback clients without proxy headers skip compression.
    expect(isLocalEventClient(makeRequest({ "accept-encoding": "gzip" }, "127.0.0.1"))).toBe(true)
    expect(isLocalEventClient(makeRequest({ "accept-encoding": "gzip" }, "::1"))).toBe(true)
    expect(isLocalEventClient(makeRequest({ "accept-encoding": "gzip" }, "::ffff:127.0.0.1"))).toBe(true)
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "gzip, br" }, "127.0.0.1"))).toBeUndefined()
    expect(negotiateEventEncoding(makeRequest({ "accept-encoding": "gzip, br" }, "::1"))).toBeUndefined()

    // Loopback connections carrying reverse-proxy headers are remote clients and get compressed.
    expect(
      negotiateEventEncoding(
        makeRequest({ "accept-encoding": "gzip", "x-forwarded-for": "100.64.0.9" }, "127.0.0.1"),
      ),
    ).toBe("gzip")
    expect(
      negotiateEventEncoding(
        makeRequest({ "accept-encoding": "br", forwarded: "for=198.51.100.1;proto=https" }, "127.0.0.1"),
      ),
    ).toBe("br")
    expect(
      negotiateEventEncoding(
        makeRequest({ "accept-encoding": "gzip", "tailscale-user-login": "user@example.com" }, "::1"),
      ),
    ).toBe("gzip")
  })

  it.live("flushes compressed experimental event frames after every event while the stream stays open", () =>
    Effect.gen(function* () {
      const source = makeSource()
      const feed = yield* EventFeed.make(source.observe)
      const webHandler = HttpRouter.toWebHandler(
        HttpApiBuilder.layer(EventApi).pipe(
          Layer.provide(EventHandler),
          Layer.provide(Layer.succeed(EventFeed.Service, feed)),
          Layer.provide(schemaErrorLayer),
          Layer.provide(
            Layer.succeed(
              Authorization,
              Authorization.of((effect) => effect),
            ),
          ),
          Layer.provide(HttpServer.layerServices),
        ),
      ).handler

      for (const encoding of ["gzip", "br"] as const) {
        const abort = new AbortController()
        const response = yield* Effect.promise(() =>
          webHandler(
            new Request("http://opencode.local/api/experimental/event?detail=subscribed", {
              headers: { "accept-encoding": encoding },
              signal: abort.signal,
            }),
          ),
        )

        expect(response.status).toBe(200)
        expect(response.headers.get("content-encoding")).toBe(encoding)
        expect(response.headers.get("vary")).toContain("Accept-Encoding")
        if (!response.body) throw new Error("Expected response stream body")

        const reader = response.body.getReader()
        const decompressor = encoding === "gzip" ? createGunzip() : createBrotliDecompress()
        const chunks: Array<string> = []
        let notify: (() => void) | undefined
        decompressor.on("data", (chunk: Buffer) => {
          chunks.push(chunk.toString("utf8"))
          notify?.()
        })

        const nextDecompressedFrame = async (): Promise<string> => {
          while (!chunks.join("").includes("\n\n")) {
            const waitData = new Promise<void>((resolve) => {
              notify = resolve
            })
            const part = await reader.read()
            if (part.done) break
            decompressor.write(part.value)
            await waitData
          }
          const combined = chunks.join("")
          const splitIndex = combined.indexOf("\n\n")
          const frame = combined.slice(0, splitIndex)
          const rest = combined.slice(splitIndex + 2)
          chunks.length = 0
          if (rest) chunks.push(rest)
          if (frame.startsWith(":")) return nextDecompressedFrame()
          return frame
        }

        // First frame (server.connected) arrives and decompresses while the stream remains open.
        const firstFrame = yield* Effect.promise(() => nextDecompressedFrame())
        expect(firstFrame).toContain('"type":"server.connected"')

        // Publish a live event and verify it flushes immediately without closing the stream.
        yield* source.publish(event(`live_${encoding}`))
        const secondFrame = yield* Effect.promise(() => nextDecompressedFrame())
        expect(secondFrame).toContain(`"id":"evt_live_${encoding}"`)

        abort.abort()
        yield* Effect.promise(() => reader.cancel())
        decompressor.destroy()
      }
    }),
  )
})
