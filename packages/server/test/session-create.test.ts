import { expect } from "bun:test"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const SessionsResponse = Schema.Struct({ data: Schema.Array(Schema.toEncoded(Session.Info)) })

it.live("creates a child at its parent's location and lists it under the parent", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
    })
    const create = (body: unknown) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        )
        expect(response.status).toBe(200)
        return Schema.decodeUnknownSync(SessionResponse)(await response.json()).data
      })
    const parent = yield* create({ title: "Parent" })
    const child = yield* create({ parentID: parent.id, title: "Child", location: { directory: "/unused" } })
    const response = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session?parentID=${parent.id}`)),
    )
    expect(response.status).toBe(200)
    const children = Schema.decodeUnknownSync(SessionsResponse)(yield* Effect.promise(() => response.json()))

    expect(child).toMatchObject({ parentID: parent.id, location: parent.location })
    expect(children.data.map((session) => session.id)).toEqual([child.id])
  }).pipe(Effect.scoped),
)

it.live("returns not found when creating a child of a missing session", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
    })
    const parentID = Session.ID.create()
    const response = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parentID, title: "Child" }),
        }),
      ),
    )
    expect(response.status).toBe(404)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "SessionNotFoundError",
      sessionID: parentID,
    })
  }).pipe(Effect.scoped),
)

it.live("spawns a child session and reports it under the parent", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const parent = Schema.decodeUnknownSync(SessionResponse)(
      yield* Effect.promise(async () => {
        const response = await handler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Parent" }),
          }),
        )
        expect(response.status).toBe(200)
        return response.json()
      }),
    ).data
    const spawned = yield* Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local/api/experimental/session/${parent.id}/spawn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Child", notify: false }),
        }),
      )
      expect(response.status).toBe(200)
      return Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
        await response.json(),
      ).data
    })
    const children = Schema.decodeUnknownSync(SessionsResponse)(
      yield* Effect.promise(async () => {
        const response = await handler(new Request(`http://opencode.local/api/session?parentID=${parent.id}`))
        expect(response.status).toBe(200)
        return response.json()
      }),
    )
    expect(children.data.map((session) => session.id)).toEqual([spawned.id])
  }).pipe(Effect.scoped),
)

it.live("spawns a child at a caller-chosen id and replays a retry without duplicating it", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const parent = Schema.decodeUnknownSync(SessionResponse)(
      yield* Effect.promise(async () => {
        const response = await handler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Parent" }),
          }),
        )
        expect(response.status).toBe(200)
        return response.json()
      }),
    ).data
    const body = JSON.stringify({ id: Session.ID.create(), title: "Child", notify: false })
    const spawn = () =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://opencode.local/api/experimental/session/${parent.id}/spawn`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }),
        )
        expect(response.status).toBe(200)
        return Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Session.ID }) }))(
          await response.json(),
        ).data
      })
    const spawned = yield* spawn()
    const replayed = yield* spawn()
    const children = Schema.decodeUnknownSync(SessionsResponse)(
      yield* Effect.promise(async () => {
        const response = await handler(new Request(`http://opencode.local/api/session?parentID=${parent.id}`))
        expect(response.status).toBe(200)
        return response.json()
      }),
    )

    expect(spawned.id).toBe(JSON.parse(body).id)
    expect(replayed.id).toBe(spawned.id)
    expect(children.data.map((session) => session.id)).toEqual([spawned.id])
  }).pipe(Effect.scoped),
)

it.live("returns conflict when the spawn id is not a child of this parent", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const parent = Schema.decodeUnknownSync(SessionResponse)(
      yield* Effect.promise(async () => {
        const response = await handler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Parent" }),
          }),
        )
        expect(response.status).toBe(200)
        return response.json()
      }),
    ).data
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/experimental/session/${parent.id}/spawn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: parent.id, title: "Child", notify: false }),
        }),
      ),
    )
    expect(response.status).toBe(409)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "ConflictError",
      resource: parent.id,
    })
  }).pipe(Effect.scoped),
)

it.live("returns not found when spawning under a missing session", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const parentID = Session.ID.create()
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/experimental/session/${parentID}/spawn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Child" }),
        }),
      ),
    )
    expect(response.status).toBe(404)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      _tag: "SessionNotFoundError",
      sessionID: parentID,
    })
  }).pipe(Effect.scoped),
)

it.live("waits for an idle session and returns its outcome and text", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const session = Schema.decodeUnknownSync(SessionResponse)(
      yield* Effect.promise(async () => {
        const response = await handler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Idle" }),
          }),
        )
        expect(response.status).toBe(200)
        return response.json()
      }),
    ).data
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/experimental/session/${session.id}/wait`, { method: "POST" }),
      ),
    )
    expect(response.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(
        Schema.Struct({
          data: Schema.Struct({
            outcome: Schema.optional(Schema.Literals(["succeeded", "failed", "interrupted"])),
            text: Schema.String,
          }),
        }),
      )(yield* Effect.promise(() => response.json())).data,
    ).toEqual({ text: "Subagent completed without a text response." })
  }).pipe(Effect.scoped),
)
