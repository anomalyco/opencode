import { expect } from "bun:test"
import { SessionTitle } from "@opencode/core/session/title"
import { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { Effect, Layer, Schema } from "effect"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const SessionsResponse = Schema.Struct({ data: Schema.Array(Schema.toEncoded(Session.Info)) })

const server = Effect.gen(function* () {
  const generated: string[] = []
  const recorder = Layer.mock(SessionTitle.Service)({
    generate: (sessionID) => Effect.sync(() => void generated.push(sessionID)),
  })
  const handler = yield* ServerFetch.make(
    {
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    },
    { overrides: [SessionTitle.node.replace(recorder), Global.node.replace(tempGlobalLayer)] },
  )
  const request = (path: string, method: string, body?: unknown) =>
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
  const session = (path: string) =>
    Effect.map(request(path, "GET"), (body) => Schema.decodeUnknownSync(SessionResponse)(body).data)
  const created = Schema.decodeUnknownSync(SessionResponse)(
    yield* request("/api/session", "POST", { title: "Created", metadata: { source: "create", stale: true } }),
  ).data
  return { request, session, created, generated }
})

it.live("updates session metadata through PATCH", () =>
  Effect.gen(function* () {
    const fixture = yield* server
    yield* fixture.request(`/api/session/${fixture.created.id}`, "PATCH", { metadata: { source: "patch" } })
    const updated = yield* fixture.session(`/api/session/${fixture.created.id}`)
    expect(updated.metadata).toEqual({ source: "patch" })
    expect(updated.title).toBe("Created")
    expect(fixture.generated).toEqual([])
  }).pipe(Effect.scoped),
)

it.live("archives and unarchives a session through PATCH", () =>
  Effect.gen(function* () {
    const fixture = yield* server
    const listed = (archived: boolean) =>
      fixture
        .request(`/api/session?archived=${archived}`, "GET")
        .pipe(Effect.map((body) => Schema.decodeUnknownSync(SessionsResponse)(body).data.map((item) => item.id)))

    yield* fixture.request(`/api/session/${fixture.created.id}`, "PATCH", { archived: true })
    expect((yield* fixture.session(`/api/session/${fixture.created.id}`)).time.archived).toBeNumber()
    expect(yield* listed(true)).toContain(fixture.created.id)
    expect(yield* listed(false)).not.toContain(fixture.created.id)

    yield* fixture.request(`/api/session/${fixture.created.id}`, "PATCH", { archived: false })
    expect((yield* fixture.session(`/api/session/${fixture.created.id}`)).time.archived).toBeUndefined()
    expect(yield* listed(false)).toContain(fixture.created.id)
  }).pipe(Effect.scoped),
)

it.live("renames a session through PATCH with a title", () =>
  Effect.gen(function* () {
    const fixture = yield* server
    yield* fixture.request(`/api/session/${fixture.created.id}`, "PATCH", { title: "Renamed" })
    expect((yield* fixture.session(`/api/session/${fixture.created.id}`)).title).toBe("Renamed")
    expect(fixture.generated).toEqual([])
  }).pipe(Effect.scoped),
)

it.live("regenerates a session title through PATCH with an empty title", () =>
  Effect.gen(function* () {
    const fixture = yield* server
    yield* fixture.request(`/api/session/${fixture.created.id}`, "PATCH", { title: "" })
    expect((yield* fixture.session(`/api/session/${fixture.created.id}`)).title).toBe("Created")
    expect(fixture.generated).toEqual([fixture.created.id])
  }).pipe(Effect.scoped),
)
