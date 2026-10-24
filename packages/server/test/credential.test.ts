import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const CreatedResponse = Schema.Struct({ data: Schema.Struct({ id: Schema.String }) })
const ListResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      value: Schema.Struct({ type: Schema.Literal("key"), key: Schema.String }),
    }),
  ),
})

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
      expect(response.status).toBe(method === "PATCH" ? 204 : 200)
      return response.status === 204 ? undefined : response.json()
    })
})

it.live("rotates the secret value through PATCH", () =>
  Effect.gen(function* () {
    const request = yield* makeRequest()
    const created = Schema.decodeUnknownSync(CreatedResponse)(
      yield* request("/api/credential", "POST", {
        integrationID: "credential-rotation-test",
        label: "expired",
        value: { type: "key", key: "expired-key" },
      }),
    )
    yield* request(`/api/credential/${created.data.id}`, "PATCH", {
      label: "rotated",
      value: { type: "key", key: "rotated-key" },
    })
    const listed = Schema.decodeUnknownSync(ListResponse)(yield* request("/api/credential", "GET"))
    const entry = listed.data.find((item) => item.id === created.data.id)

    expect(entry?.label).toBe("rotated")
    expect(entry?.value.key).toBe("rotated-key")
  }).pipe(Effect.scoped),
)

it.live("keeps the stored value when PATCH sends only a label", () =>
  Effect.gen(function* () {
    const request = yield* makeRequest()
    const created = Schema.decodeUnknownSync(CreatedResponse)(
      yield* request("/api/credential", "POST", {
        integrationID: "credential-rotation-test",
        label: "original",
        value: { type: "key", key: "original-key" },
      }),
    )
    yield* request(`/api/credential/${created.data.id}`, "PATCH", { label: "renamed" })
    const listed = Schema.decodeUnknownSync(ListResponse)(yield* request("/api/credential", "GET"))
    const entry = listed.data.find((item) => item.id === created.data.id)

    expect(entry?.label).toBe("renamed")
    expect(entry?.value.key).toBe("original-key")
  }).pipe(Effect.scoped),
)
