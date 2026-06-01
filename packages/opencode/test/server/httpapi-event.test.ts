import { afterEach, describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Queue, Schema, Stream } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Database } from "@opencode-ai/core/database/database"
import { EventTable } from "@opencode-ai/core/event/sql"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { V2Schema } from "@opencode-ai/core/v2-schema"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

void Log.init({ print: false })

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

const it = testEffect(Layer.mergeAll(httpApiLayer, EventV2Bridge.defaultLayer, Database.defaultLayer))

const sessionNextData = (sessionID: SessionSchema.ID, timestamp = 1234) => ({
  sessionID,
  timestamp: DateTime.makeUnsafe(timestamp),
  agent: "test-agent",
  model: { id: ModelV2.ID.make("test-model"), providerID: ProviderV2.ID.make("test-provider") },
})

const FanoutEncodeFailureEvent = EventV2.define({
  type: "test.fanout.encode-failure",
  schema: {
    timestamp: V2Schema.DateTimeUtcFromMillis,
  },
})

const fanoutEncodeFailureData = () => ({
  timestamp: {} as typeof V2Schema.DateTimeUtcFromMillis.Type,
})

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
    "stores encoded session.next timestamps",
    () =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const { db } = yield* Database.Service
        const sessionID = SessionSchema.ID.descending()

        yield* events.publish(SessionEvent.Step.Started, sessionNextData(sessionID))

        const row = yield* db.select().from(EventTable).all().pipe(Effect.orDie).pipe(Effect.map((rows) => rows[0]))
        expect(row?.data.timestamp).toBe(1234)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "emits encoded session.next timestamps on GlobalBus",
    () =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const sessionID = SessionSchema.ID.descending()
        const received: GlobalEvent[] = []
        const handler = (event: GlobalEvent) => received.push(event)
        yield* Effect.sync(() => GlobalBus.on("event", handler))
        yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", handler)))

        yield* events.publish(SessionEvent.Step.Started, sessionNextData(sessionID))

        const event = received.find((event) => event.payload.type === SessionEvent.Step.Started.type)
        expect(event).toBeDefined()
        expect(event?.payload.properties).toMatchObject({ timestamp: 1234 })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "does not fail publish when GlobalBus fanout encoding fails",
    () =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const received: GlobalEvent[] = []
        const handler = (event: GlobalEvent) => received.push(event)
        yield* Effect.sync(() => GlobalBus.on("event", handler))
        yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", handler)))

        const event = yield* events.publish(FanoutEncodeFailureEvent, fanoutEncodeFailureData())

        expect(event.type).toBe(FanoutEncodeFailureEvent.type)
        expect(received.some((event) => event.payload.type === FanoutEncodeFailureEvent.type)).toBe(false)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "emits encoded session.next timestamps on the event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const events = yield* EventV2Bridge.Service
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        const sessionID = SessionSchema.ID.descending()
        yield* events.publish(SessionEvent.Step.Started, sessionNextData(sessionID))

        const event = yield* readEvent(reader)
        expect(event).toMatchObject({ type: SessionEvent.Step.Started.type, properties: { timestamp: 1234 } })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps the event stream open when fanout encoding fails",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const events = yield* EventV2Bridge.Service
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        yield* events.publish(FanoutEncodeFailureEvent, fanoutEncodeFailureData())

        const sessionID = SessionSchema.ID.descending()
        yield* events.publish(SessionEvent.Step.Started, sessionNextData(sessionID))

        const event = yield* readEvent(reader)
        expect(event).toMatchObject({ type: SessionEvent.Step.Started.type, properties: { timestamp: 1234 } })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "decodes replayed session.next timestamps for listeners",
    () =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const received = yield* Queue.unbounded<EventV2.Payload>()
        const unsubscribe = yield* events.listen((event) => Effect.sync(() => Queue.offerUnsafe(received, event)))
        yield* Effect.addFinalizer(() => unsubscribe)

        const sessionID = SessionSchema.ID.descending()
        yield* events.replay(
          {
            id: EventV2.ID.create(),
            aggregateID: sessionID,
            seq: 0,
            type: EventV2.versionedType(SessionEvent.Step.Started.type, 1),
            data: { ...sessionNextData(sessionID), timestamp: 1234 },
          },
          { publish: true },
        )

        const event = yield* Queue.take(received)
        expect(DateTime.toEpochMillis((event.data as typeof SessionEvent.Step.Started.data.Type).timestamp)).toBe(1234)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "normalizes legacy ISO session.next timestamps during replay",
    () =>
      Effect.gen(function* () {
        const events = yield* EventV2Bridge.Service
        const received = yield* Queue.unbounded<EventV2.Payload>()
        const unsubscribe = yield* events.listen((event) => Effect.sync(() => Queue.offerUnsafe(received, event)))
        yield* Effect.addFinalizer(() => unsubscribe)

        const sessionID = SessionSchema.ID.descending()
        yield* events.replay(
          {
            id: EventV2.ID.create(),
            aggregateID: sessionID,
            seq: 0,
            type: EventV2.versionedType(SessionEvent.Step.Started.type, 1),
            data: { ...sessionNextData(sessionID), timestamp: new Date(1234).toISOString() },
          },
          { publish: true },
        )

        const event = yield* Queue.take(received)
        expect(DateTime.toEpochMillis((event.data as typeof SessionEvent.Step.Started.data.Type).timestamp)).toBe(1234)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
