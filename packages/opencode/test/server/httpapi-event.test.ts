import { afterEach, describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Bus } from "../../src/bus"
import { Event as ServerEvent } from "../../src/server/event"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffectShared } from "../lib/effect"

void Log.init({ print: false })

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  sseID: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

function parseSseEvent(text: string) {
  const id = text
    .split("\n")
    .find((line) => line.startsWith("id: "))
    ?.slice("id: ".length)
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n")
  return { sseID: id, ...JSON.parse(data) }
}

const readSseEvent = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() => reader.read()).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for event")),
      }),
    )
    if (result.done || !result.value) return yield* Effect.fail(new Error("event stream closed"))
    return parseSseEvent(new TextDecoder().decode(result.value))
  })

const readEvent = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  readSseEvent(reader).pipe(Effect.map(Schema.decodeUnknownSync(EventData)))

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

const openGlobalEventStream = () =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(async () => Server.Default().app.request(GlobalPaths.event))
    if (!response.body) return yield* Effect.die("missing SSE response body")
    const reader = response.body.getReader()
    yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel().catch(() => undefined)))
    return { response, reader }
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
        const event = yield* readEvent(reader)
        expect(event).toMatchObject({ type: "server.connected", properties: {} })
        expect(event.sseID).toBe(event.id)
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
        const event = yield* readEvent(reader)
        expect(event).toMatchObject({ type: "server.connected", properties: {} })
        expect(event.sseID).toBe(event.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.effect("sets SSE ids on global events", () =>
    Effect.gen(function* () {
      const { response, reader } = yield* openGlobalEventStream()
      expect(response.status).toBe(200)

      const event = yield* readSseEvent(reader)
      expect(event).toMatchObject({ payload: { type: "server.connected" } })
      expect(event.sseID).toBe(event.payload.id)
    }),
  )
})
