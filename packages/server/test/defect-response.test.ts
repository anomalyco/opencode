import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { Context, Effect } from "effect"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { serveRoutes } from "./fixture/routes"

const large = "x".repeat(60_000)

const boot = Effect.gen(function* () {
  const dir = yield* tmpdirScoped("opencode-defect-response-")
  const server = yield* serveRoutes(
    {
      app: { version: "test" },
      database: { path: path.join(dir.path, "opencode.db") },
      models: { fetch: false },
      fs: { filewatcher: false },
    },
    [Global.node.replace(tempGlobalLayer)],
  )
  const db = Context.get(server.context, Database.Service).db
  return {
    db,
    location: { directory: dir.path },
    request: (method: string, route: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await server.fetch(`http://opencode.local${route}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        return { status: response.status, body: await response.text() }
      }),
    api: OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(
        (input: string | URL | Request, init?: RequestInit) => server.handler(new Request(input, init)),
        { preconnect: fetch.preconnect },
      ),
    }),
  }
})

it.live("a write on a full disk answers 500 with the storage reason instead of an empty body", () =>
  Effect.gen(function* () {
    const server = yield* boot
    const session = yield* Effect.promise(() => server.api.session.create({ location: server.location }))
    // A real SQLITE_FULL: SQLite never lowers the limit below the current size, so 1 means the database may not grow
    // and a write that needs a new page fails.
    yield* server.db.run("PRAGMA max_page_count = 1").pipe(Effect.orDie)

    const prompt = yield* server.request("POST", `/api/session/${session.id}/prompt`, { text: large })
    expect(prompt.status).toBe(500)
    expect(JSON.parse(prompt.body)).toEqual({
      _tag: "UnknownError",
      message: "Storage is full",
      ref: expect.stringMatching(/^err_[0-9a-f]{8}$/),
    })
  }),
)

it.live("other defects answer 500 with a ref, and unknown routes keep their 404", () =>
  Effect.gen(function* () {
    const server = yield* boot
    const session = yield* Effect.promise(() => server.api.session.create({ location: server.location }))
    // A query that is simply wrong is a bug, not a storage failure: an empty table shadows the sessions.
    yield* server.db.run("CREATE TEMP TABLE session_v2 (shadow text)").pipe(Effect.orDie)
    const read = yield* server.request("GET", `/api/session/${session.id}`)
    yield* server.db.run("DROP TABLE temp.session_v2").pipe(Effect.orDie)
    expect(read.status).toBe(500)
    expect(JSON.parse(read.body)).toEqual({
      _tag: "UnknownError",
      message: "Server failed to handle the request. Check server logs for details.",
      ref: expect.stringMatching(/^err_[0-9a-f]{8}$/),
    })

    expect((yield* server.request("GET", "/api/does-not-exist")).status).toBe(404)
  }),
)
