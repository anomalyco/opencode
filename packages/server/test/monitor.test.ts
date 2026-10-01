import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Database } from "@opencode/core/database/database"
import { KVTable } from "@opencode/core/kv/sql"
import { Monitor } from "@opencode/schema/monitor"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Shell } from "@opencode/schema/shell"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { ServerProcess } from "../src/process"
import { createRoutes } from "../src/routes"

it.live("lists session monitors through the generated client and rejects unknown sessions", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
        preconnect: fetch.preconnect,
      }),
    })
    yield* Effect.promise(async () => {
      const session = await api.session.create({ title: "Background monitors" })
      expect(await api.monitor.list({ sessionID: session.id })).toEqual([])
      const sessionID = Session.ID.create()
      const response = await handler(new Request(`http://opencode.local/api/session/${sessionID}/monitor`))
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ _tag: "SessionNotFoundError", sessionID })
    })
  }),
)

it.live("reconciles running monitors before a plain server accepts requests", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped("opencode-monitor-restart-")
    const options = {
      app: { version: "test" },
      database: { path: `${directory.path}/opencode.db` },
      config: { directory: directory.path, project: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    }
    const sessionID = Session.ID.create()
    const info = Monitor.Info.make({
      id: Monitor.ID.create(),
      sessionID,
      shellID: Shell.ID.create(),
      description: "Old server watch",
      delivery: "steer",
      log: `${directory.path}/old-monitor.log`,
      startedAt: 1,
      expiresAt: 300_001,
      eventCount: 3,
      outputBytes: 42,
      status: "running",
    })
    yield* Effect.promise(() => Bun.write(info.log, "shard failed\nstderr diagnostic\n"))
    yield* Effect.gen(function* () {
      const context = yield* Layer.build(createRoutes(options).pipe(Layer.provide(HttpServer.layerServices)))
      const database = Context.get(context, Database.Service)
      const { Session } = yield* Effect.promise(() => import("@opencode/core/session"))
      const sessions = Context.get(context, Session.Service)
      yield* sessions.create({ id: sessionID, location: { directory: AbsolutePath.make(directory.path) } })
      yield* database.db
        .insert(KVTable)
        .values({
          key: `monitor/${sessionID}/${info.id}`,
          value: Schema.encodeSync(Monitor.Info)(info),
        })
        .run()
        .pipe(Effect.orDie)
    }).pipe(Effect.scoped)

    const server = yield* ServerProcess.start<never, never>({
      ...options,
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
    })
    const response = yield* Effect.promise(() =>
      fetch(new URL(`/api/session/${sessionID}/monitor`, HttpServer.formatAddress(server.address)), {
        headers: { authorization: `Basic ${btoa("opencode:secret")}` },
      }),
    )
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject([
      { ...info, status: "ended", reason: "server_restarted" },
    ])
    const api = OpenCode.make({
      baseUrl: HttpServer.formatAddress(server.address),
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    })
    expect((yield* Effect.promise(() => api.monitor.output({ sessionID, id: info.id, limit: 12 }))).output).toBe(
      "shard failed",
    )
    const other = yield* Effect.promise(() =>
      fetch(
        new URL(
          `/api/session/${sessionID}/monitor/${Monitor.ID.create()}/output`,
          HttpServer.formatAddress(server.address),
        ),
        { headers: { authorization: `Basic ${btoa("opencode:secret")}` } },
      ),
    )
    expect(other.status).toBe(404)
    expect((yield* Effect.promise(() => api.monitor.stop({ sessionID, id: info.id }))).reason).toBe("server_restarted")
    const unrelated = yield* Effect.promise(() => api.session.create({ title: "Other session" }))
    const denied = yield* Effect.promise(() =>
      fetch(
        new URL(`/api/session/${unrelated.id}/monitor/${info.id}/output`, HttpServer.formatAddress(server.address)),
        { headers: { authorization: `Basic ${btoa("opencode:secret")}` } },
      ),
    )
    expect(denied.status).toBe(404)
  }),
)
