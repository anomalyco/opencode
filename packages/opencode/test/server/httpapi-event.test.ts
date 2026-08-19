import { afterEach, describe, expect } from "bun:test"
import { Effect, Queue, Schema, Stream } from "effect"
import { HttpServer } from "effect/unstable/http"
import * as NodeHttp from "node:http"
import { GlobalBus } from "../../src/bus/global"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { InstanceStore } from "../../src/project/instance-store"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

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

const readEventType = (reader: Queue.Dequeue<Uint8Array>, type: string) =>
  Effect.gen(function* () {
    while (true) {
      const event = yield* readEvent(reader)
      if (event.type === type) return event
    }
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

const openTcpEventStream = (url: string, directory: string) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{
          response: { status: number }
          next: () => Promise<typeof EventData.Type>
          close: () => Promise<void>
        }>((resolve, reject) => {
          const request = NodeHttp.get(url, {
            headers: { "x-opencode-directory": directory },
          })
          request.once("error", reject)
          request.once("response", (response) => {
            let buffer = ""
            let closed = false
            const values: Array<typeof EventData.Type> = []
            const waiters: Array<{
              resolve: (event: typeof EventData.Type) => void
              reject: (error: Error) => void
            }> = []
            const flush = () => {
              while (true) {
                const boundary = buffer.indexOf("\n\n")
                if (boundary < 0) return
                const raw = buffer.slice(0, boundary)
                buffer = buffer.slice(boundary + 2)
                const data = raw
                  .split("\n")
                  .find((line) => line.startsWith("data: "))
                  ?.slice(6)
                if (!data) continue
                const event = Schema.decodeUnknownSync(EventData)(JSON.parse(data))
                const waiter = waiters.shift()
                if (waiter) waiter.resolve(event)
                else values.push(event)
              }
            }
            response.setEncoding("utf8")
            response.on("data", (chunk: string) => {
              buffer += chunk.replaceAll("\r\n", "\n")
              flush()
            })
            response.once("error", (error) => {
              while (waiters.length > 0) waiters.shift()!.reject(error)
            })
            const next = () => {
              const value = values.shift()
              if (value) return Promise.resolve(value)
              return new Promise<typeof EventData.Type>((resolve, reject) => waiters.push({ resolve, reject }))
            }
            const close = async () => {
              if (closed) return
              closed = true
              const done = new Promise<void>((resolve) => response.once("close", resolve))
              response.destroy()
              request.destroy()
              await done
            }
            resolve({ response: { status: response.statusCode ?? 0 }, next, close })
          })
        }),
    ),
    (client) => Effect.promise(client.close),
  )

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
    20_000,
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
    20_000,
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
    20_000,
  )

  it.instance(
    "survives instance disposal and receives replacement events",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const store = yield* InstanceStore.Service
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        yield* store.reload({ directory })
        expect(yield* readEventType(reader, "server.instance.disposed")).toMatchObject({
          type: "server.instance.disposed",
          properties: { directory },
        })

        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        expect(yield* readEventType(reader, "session.created")).toMatchObject({ type: "session.created" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
    20_000,
  )

  it.instance(
    "releases subscriptions when a TCP client disconnects",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const store = yield* InstanceStore.Service
        const server = yield* HttpServer.HttpServer
        const baseline = GlobalBus.listenerCount("event")
        const client = yield* openTcpEventStream(
          new URL(EventPaths.event, HttpServer.formatAddress(server.address)).toString(),
          directory,
        )

        expect(client.response.status).toBe(200)
        expect(yield* Effect.promise(client.next)).toMatchObject({ type: "server.connected" })
        expect(GlobalBus.listenerCount("event")).toBe(baseline + 1)

        yield* store.reload({ directory })
        expect(yield* Effect.promise(client.next)).toMatchObject({
          type: "server.instance.disposed",
          properties: { directory },
        })
        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        let event = yield* Effect.promise(client.next)
        while (event.type !== "session.created") event = yield* Effect.promise(client.next)

        yield* Effect.promise(client.close)
        yield* pollWithTimeout(
          Effect.sync(() => (GlobalBus.listenerCount("event") === baseline ? true : undefined)),
          "GlobalBus listener was retained after TCP disconnect",
        )
        expect(GlobalBus.listenerCount("event")).toBe(baseline)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    20_000,
  )
})
