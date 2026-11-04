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
