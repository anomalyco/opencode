import { expect } from "bun:test"
import { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { Workspace } from "@opencode/schema/workspace"
import { OpenCode } from "@opencode/client"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import path from "path"
import { it } from "../../core/test/lib/effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { ServerFetch } from "../src/fetch"
import { createEmbeddedRoutes } from "../src/routes"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })
const SessionsResponse = Schema.Struct({ data: Schema.Array(Schema.toEncoded(Session.Info)) })

it.live("an explicit HTTP location selects local placement while omission preserves the parent's workspace", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const context = yield* Layer.build(
      createEmbeddedRoutes({
        app: { version: "test" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
      }).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const sessions = Context.get(context, Session.Service)
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const parent = yield* sessions.create({
      location: { directory: AbsolutePath.make(tmp.path), workspaceID: Workspace.ID.make("wrk_parent") },
    })
    const create = (location?: { directory: string }) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request("http://opencode.local/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ parentID: parent.id, location }),
          }),
        )
        expect(response.status).toBe(200)
        return Session.ID.make(Schema.decodeUnknownSync(SessionResponse)(await response.json()).data.id)
      })
    const inherited = yield* sessions.get(yield* create())
    const explicit = yield* sessions.get(yield* create({ directory: `${tmp.path}${path.sep}` }))
    expect(inherited.location).toEqual(parent.location)
    expect(explicit.location.directory).toBe(parent.location.directory)
    expect(explicit.location.workspaceID).toBeUndefined()
  }).pipe(Effect.scoped),
)

it.live("creates a child at its parent's location and lists it under the parent", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
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
    const parent = yield* create({ title: "Parent", location: { directory: tmp.path } })
    const child = yield* create({ parentID: parent.id, title: "Child" })
    const response = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/session?parentID=${parent.id}`)),
    )
    expect(response.status).toBe(200)
    const children = Schema.decodeUnknownSync(SessionsResponse)(yield* Effect.promise(() => response.json()))

    expect(child).toMatchObject({ parentID: parent.id, location: parent.location })
    expect(children.data.map((session) => session.id)).toEqual([child.id])
  }).pipe(Effect.scoped),
)

it.live("the generated client creates a child at an explicit location and retries keep its placement", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
    })
    const client = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
        preconnect: fetch.preconnect,
      }),
    })
    yield* Effect.promise(async () => {
      const parent = await client.session.create({ title: "Parent" })
      const child = await client.session.create({
        parentID: parent.id,
        location: { directory: `${tmp.path}${path.sep}` },
      })
      expect(child).toMatchObject({ parentID: parent.id, location: { directory: tmp.path } })
      expect(child.location).not.toEqual(parent.location)
      expect((await client.session.list({ parentID: parent.id })).data.map((session) => session.id)).toEqual([child.id])
      expect(await client.session.create({ id: child.id, parentID: parent.id, location: parent.location })).toEqual(
        child,
      )
    })
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
          body: JSON.stringify({ parentID, title: "Child", location: { directory: process.cwd() } }),
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
