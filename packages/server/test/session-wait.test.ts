import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

const makeFetch = Effect.fn(function* () {
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  return (path: string, method: string, body?: unknown) =>
    Effect.promise(() =>
      handler(
        new Request(`http://opencode.local${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    )
})

it.live("answers session.wait with an event stream carrying one result event", () =>
  Effect.gen(function* () {
    const request = yield* makeFetch()
    const createdResponse = yield* request("/api/session", "POST", {})
    const created = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => createdResponse.json()))
    const response = yield* request(`/api/experimental/session/${created.data.id}/wait`, "POST")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toStartWith("text/event-stream")
    const frames = (yield* Effect.promise(() => response.text())).split("\n\n").filter((frame) => frame !== "")
    expect(frames.filter((frame) => !frame.startsWith(": heartbeat"))).toEqual(["data: {}"])
  }).pipe(Effect.scoped),
)

it.live("rejects session.wait for a missing session before streaming", () =>
  Effect.gen(function* () {
    const request = yield* makeFetch()
    const response = yield* request(`/api/experimental/session/${Session.ID.create()}/wait`, "POST")
    expect(response.status).toBe(404)
  }).pipe(Effect.scoped),
)
