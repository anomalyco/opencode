import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer, Queue, Schema, Stream } from "effect"
import { GlobalBus } from "@/bus/global"
import { SUBSCRIBER_BACKLOG_CAPACITY } from "../../src/server/routes/instance/httpapi/handlers/backlog"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request, requestInDirectory } from "./httpapi-layer"

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

const readEvent = (reader: Queue.Dequeue<Uint8Array>) =>
  Effect.gen(function* () {
    const value = yield* Queue.take(reader).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for event")),
      }),
    )
    return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(value).replace(/^data: /, "")))
  })

const openEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* requestInDirectory(EventPaths.event, directory)
    const reader = yield* Queue.unbounded<Uint8Array>()
    yield* response.stream.pipe(
      Stream.runForEach((value) => Queue.offer(reader, value)),
      Effect.forkScoped,
    )
    return { response, reader }
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("event HttpApi", () => {
  it.instance(
    "serves event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { response, reader } = yield* openEventStream(directory)

        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toContain("text/event-stream")
        expect(response.headers["cache-control"]).toBe("no-cache, no-transform")
        expect(response.headers["x-accel-buffering"]).toBe("no")
        expect(response.headers["x-content-type-options"]).toBe("nosniff")
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps the event stream open after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        // If no second event arrives within 250ms, the stream is still open.
        const status = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers instance events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        expect(yield* readEvent(reader)).toMatchObject({ type: "session.created" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "ends the global stream instead of buffering without bound when the consumer stalls",
    () =>
      Effect.gen(function* () {
        const response = yield* request(GlobalPaths.event)
        expect(response.status).toBe(200)

        // Do not consume the body: this is the half-dead consumer (#20695).
        // The listener is registered eagerly, so the backlog fills anyway;
        // emitting in one tight loop reproduces a consumer that never drains.
        yield* Effect.sync(() => {
          for (let index = 0; index < SUBSCRIBER_BACKLOG_CAPACITY + 100; index++) {
            GlobalBus.emit("event", { directory: "global", payload: { type: "flood", properties: { index } } })
          }
        })

        // With a bounded backlog the response stream completes after flushing
        // what fit; before the fix this drain never terminates because the
        // queue keeps the stream open while growing with every event.
        yield* response.stream.pipe(
          Stream.runDrain,
          Effect.timeoutOrElse({
            duration: "15 seconds",
            orElse: () => Effect.fail(new Error("stream did not terminate after backlog overflow")),
          }),
        )
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps a draining global consumer connected past the backlog capacity",
    () =>
      Effect.gen(function* () {
        const response = yield* request(GlobalPaths.event)
        expect(response.status).toBe(200)
        const reader = yield* Queue.unbounded<Uint8Array>()
        yield* response.stream.pipe(
          Stream.runForEach((value) => Queue.offer(reader, value)),
          Effect.forkScoped,
        )

        // More total events than the backlog holds, paced in batches so the
        // consumer can drain between bursts: the bound applies to the
        // undrained backlog, never to total throughput. The sleep simulates
        // producer pacing on purpose; it is not a synchronization hack.
        const batches = 24
        const perBatch = 500
        const total = batches * perBatch
        for (let batch = 0; batch < batches; batch++) {
          yield* Effect.sync(() => {
            for (let index = 0; index < perBatch; index++) {
              GlobalBus.emit("event", { directory: "global", payload: { type: "flood", properties: { index } } })
            }
          })
          yield* Effect.sleep("5 millis")
        }

        const decoder = new TextDecoder()
        let seen = 0
        while (seen < total) {
          const chunk = yield* Queue.take(reader).pipe(
            Effect.timeoutOrElse({
              duration: "30 seconds",
              orElse: () => Effect.fail(new Error(`stream ended early: saw ${seen} of ${total} events`)),
            }),
          )
          seen += (decoder.decode(chunk).match(/"type":"flood"/g) ?? []).length
        }

        // No overflow happened, so the stream must still be open.
        const status = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
