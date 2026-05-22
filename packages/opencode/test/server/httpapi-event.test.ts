import { afterEach, describe, expect } from "bun:test"
import { DateTime, Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { Bus } from "../../src/bus"
import { GlobalBus } from "../../src/bus/global"
import { Event as ServerEvent } from "../../src/server/event"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffectShared } from "../lib/effect"

void Log.init({ print: false })

// Per-type wire schema for every event this file exercises. Decoding a frame
// through this union enforces both the `{id, type, properties}` envelope and
// the per-type `properties` shape — the same Effect Schemas that generate the
// OpenAPI spec, so a wire-form regression (issue #28847 was one) fails the
// decode with a precise schema error. Add a variant when a new event type
// appears in the tests below.
const EventFrame = Schema.Union([
  Schema.Struct({
    id: Schema.optional(Schema.String),
    type: Schema.Literal(ServerEvent.Connected.type),
    properties: ServerEvent.Connected.properties,
  }),
  Schema.Struct({
    id: Schema.optional(Schema.String),
    type: Schema.Literal(SessionEvent.AgentSwitched.type),
    properties: SessionEvent.AgentSwitched.data,
  }),
])

const decodeEventFrame = Schema.decodeUnknownSync(EventFrame)

const readEvent = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() => reader.read()).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for event")),
      }),
    )
    if (result.done || !result.value) return yield* Effect.fail(new Error("event stream closed"))
    return decodeEventFrame(JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")))
  })

const openEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(async () =>
      Server.Default().app.request(EventPaths.event, { headers: { "x-opencode-directory": directory } }),
    )
    if (!response.body) return yield* Effect.die("missing SSE response body")
    const reader = response.body.getReader()
    yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel().catch(() => undefined)))
    return { response, reader }
  })

const openGlobalStream = () =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(async () => Server.Default().app.request(GlobalPaths.event))
    if (!response.body) return yield* Effect.die("missing SSE response body")
    const reader = response.body.getReader()
    yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel().catch(() => undefined)))
    return { response, reader }
  })

// /global/event wraps each emission as `{directory?, payload: <inner>}` where
// `<inner>` is either a connected/heartbeat envelope or a sync event whose
// `syncEvent.data` carries the EventV2 payload. We parse loosely here and
// decode the inner `data` through its declared Effect Schema below — that is
// the spec contract for the nested wire form.
const readGlobalFrame = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() => reader.read()).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for global event")),
      }),
    )
    if (result.done || !result.value) return yield* Effect.fail(new Error("global event stream closed"))
    return JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")) as {
      directory?: string
      payload: { id?: string; type: string; syncEvent?: { type: string; data: unknown } }
    }
  })

const waitFor = (predicate: () => boolean) =>
  Effect.gen(function* () {
    const deadline = Date.now() + 2000
    while (!predicate()) {
      if (Date.now() > deadline) return yield* Effect.fail(new Error("timed out waiting for condition"))
      yield* Effect.sleep("5 millis")
    }
  })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffectShared(Bus.defaultLayer)

describe("event HttpApi", () => {
  it.instance(
    "serves event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { response, reader } = yield* openEventStream(directory)

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("text/event-stream")
        expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
        expect(response.headers.get("x-accel-buffering")).toBe("no")
        expect(response.headers.get("x-content-type-options")).toBe("nosniff")
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
        const status = yield* Effect.promise(() => reader.read()).pipe(
          Effect.map((result) => (result.done ? ("closed" as const) : ("event" as const))),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers instance bus events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        yield* Bus.use.publish(ServerEvent.Connected, {})
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})

// Regression coverage for https://github.com/anomalyco/opencode/issues/28847.
// `session.next.*` events declare `timestamp` as the encoded form of
// `V2Schema.DateTimeUtcFromMillis` — a finite number. Effect `DateTime` values
// serialize through `toJSON()` as ISO 8601 strings, which would not satisfy
// the schema. These tests publish on both event endpoints and rely on the
// per-type schema decode above to fail loudly if the wire form drifts.
describe("event timestamp serialization", () => {
  it.instance(
    "/event encodes session.next.* timestamps as epoch millis per the schema",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect((yield* readEvent(reader)).type).toBe(ServerEvent.Connected.type)

        const now = Date.now()
        yield* Bus.use.publish(
          // `Bus.publish` wants `{type, properties: Schema}`; the EventV2-style
          // `SessionEvent.AgentSwitched` exposes its payload schema as `.data`.
          { type: SessionEvent.AgentSwitched.type, properties: SessionEvent.AgentSwitched.data },
          {
            sessionID: "ses_0000000000000000000000000000",
            timestamp: DateTime.makeUnsafe(now),
            agent: "build",
          },
        )

        // readEvent decodes the frame through `SessionEvent.AgentSwitched.data`
        // for this type — an ISO-string regression would throw with a precise
        // "Expected number, got string at .properties.timestamp" error.
        const event = yield* readEvent(reader)
        if (event.type !== SessionEvent.AgentSwitched.type) {
          return yield* Effect.fail(new Error(`unexpected event type ${event.type}`))
        }
        expect(DateTime.toEpochMillis(event.properties.timestamp)).toBe(now)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.live("/global/event encodes nested sync timestamps as epoch millis per the schema", () =>
    Effect.gen(function* () {
      const before = GlobalBus.listenerCount("event")
      const { reader } = yield* openGlobalStream()
      expect(yield* readGlobalFrame(reader)).toMatchObject({ payload: { type: "server.connected" } })

      // The global handler registers its GlobalBus listener lazily, only once
      // server.connected has drained. Wait for it before emitting so the
      // event isn't dropped before anyone is listening.
      yield* waitFor(() => GlobalBus.listenerCount("event") > before)

      const now = Date.now()
      yield* Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "/tmp/issue-28847",
          payload: {
            type: "sync",
            syncEvent: {
              type: "session.next.agent.switched.1",
              id: "evt_0000000000000000000000000000",
              seq: 0,
              aggregateID: "ses_0000000000000000000000000000",
              data: {
                sessionID: "ses_0000000000000000000000000000",
                timestamp: DateTime.makeUnsafe(now),
                agent: "build",
              },
            },
          },
        }),
      )

      const frame = yield* readGlobalFrame(reader)
      if (!frame.payload.syncEvent) return yield* Effect.fail(new Error("expected sync event in global frame"))
      // Decode the inner `data` through the EventV2 schema; succeeds iff every
      // declared field (including `timestamp` as a finite number) is on the wire.
      const data = Schema.decodeUnknownSync(SessionEvent.AgentSwitched.data)(frame.payload.syncEvent.data)
      expect(DateTime.toEpochMillis(data.timestamp)).toBe(now)
    }),
  )
})
