import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

const setup = Effect.gen(function* () {
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
  })
  return (path: string, body?: unknown, status = 200) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
      const json: unknown = await response.json()
      expect(response.status).toBe(status)
      return json
    })
})

it.live("creates a session with a fresh supplied id", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const id = Session.ID.create()
    const created = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", { id }))
    expect(created.data.id).toBe(id)
    const read = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${id}`))
    expect(read.data.id).toBe(id)
  }).pipe(Effect.scoped),
)

it.live("returns the existing session for a supplied id that already exists", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const id = Session.ID.create()
    const first = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", { id }))
    const second = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", { id }))
    expect(second.data.id).toBe(id)
    expect(second.data.time.created).toBe(first.data.time.created)
  }).pipe(Effect.scoped),
)

it.live("mints a fresh id when none is supplied", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const first = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", {}))
    const second = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", {}))
    expect(first.data.id).not.toBe(second.data.id)
    expect(first.data.id.startsWith("ses")).toBe(true)
    expect(second.data.id.startsWith("ses")).toBe(true)
  }).pipe(Effect.scoped),
)

it.live("rejects a supplied id without the ses prefix", () =>
  Effect.gen(function* () {
    const request = yield* setup
    const error = yield* request("/api/session", { id: "custom-id" }, 400)
    expect(error).toMatchObject({ _tag: "InvalidRequestError" })
  }).pipe(Effect.scoped),
)
