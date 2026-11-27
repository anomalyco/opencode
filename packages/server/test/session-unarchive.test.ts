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
  return (path: string, method: string, body?: unknown) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      )
      expect(response.status).toBeLessThan(300)
      return response.status === 204 ? undefined : response.json()
    })
})

const archivedSession = Effect.fn(function* (request: Effect.Success<ReturnType<typeof makeRequest>>) {
  const created = Schema.decodeUnknownSync(SessionResponse)(yield* request("/api/session", "POST", {}))
  const id = created.data.id
  yield* request(`/api/session/${id}`, "PATCH", { archived: true })
  const archived = () =>
    request(`/api/session/${id}`, "GET").pipe(
      Effect.map((body) => Schema.decodeUnknownSync(SessionResponse)(body).data.time.archived !== undefined),
    )
  expect(yield* archived()).toBe(true)
  return { id, archived }
})

it.live("a user prompt unarchives an archived session", () =>
  Effect.gen(function* () {
    const request = yield* makeRequest()
    const session = yield* archivedSession(request)

    yield* request(`/api/session/${session.id}/prompt`, "POST", { text: "hello", resume: false })

    expect(yield* session.archived()).toBe(false)
  }).pipe(Effect.scoped),
)

it.live("a user shell command unarchives an archived session", () =>
  Effect.gen(function* () {
    const request = yield* makeRequest()
    const session = yield* archivedSession(request)

    yield* request(`/api/session/${session.id}/shell`, "POST", { command: "true" })

    expect(yield* session.archived()).toBe(false)
  }).pipe(Effect.scoped),
)

it.live("synthetic input leaves an archived session archived", () =>
  Effect.gen(function* () {
    const request = yield* makeRequest()
    const session = yield* archivedSession(request)

    yield* request(`/api/session/${session.id}/synthetic`, "POST", { text: "background notice", resume: false })

    expect(yield* session.archived()).toBe(true)
  }).pipe(Effect.scoped),
)
