import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

const makeRequest = Effect.fn(function* () {
  const handler = yield* ServerFetch.make({
    app: { version: "test" },
    database: { path: ":memory:" },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  return (path: string, body: unknown) =>
    Effect.promise(() =>
      handler(
        new Request(`http://opencode.local${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    )
})

it.live("accepts presence reports and ignores unknown sessions", () =>
  Effect.gen(function* () {
    const request = yield* makeRequest()
    const createdResponse = yield* request("/api/session", {})
    const created = Schema.decodeUnknownSync(SessionResponse)(
      yield* Effect.promise(() => createdResponse.json()),
    )
    const presence = (body: unknown) =>
      request("/api/experimental/session/presence", body).pipe(Effect.map((response) => response.status))

    expect(yield* presence({ client: "test-client", sessions: [created.data.id] })).toBe(204)
    // A replaced set and an unknown Session ID are both accepted; the registry ignores the unknown one.
    expect(yield* presence({ client: "test-client", sessions: [Session.ID.make("ses_missing")] })).toBe(204)
    expect(yield* presence({ client: "test-client", sessions: [] })).toBe(204)
  }).pipe(Effect.scoped),
)

it.live("rejects a presence report without a client", () =>
  Effect.gen(function* () {
    const request = yield* makeRequest()
    const response = yield* request("/api/experimental/session/presence", { sessions: [] })
    expect(response.status).toBe(400)
  }).pipe(Effect.scoped),
)
