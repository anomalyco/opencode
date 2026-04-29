import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/sync"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const originalHttpApi = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

function app(httpapi = true) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = httpapi
  return Server.Default().app
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = originalHttpApi
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await Instance.disposeAll()
  await resetDatabase()
})

describe("sync HttpApi", () => {
  test("serves sync routes through Hono bridge", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }

    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => runSession(Session.Service.use((svc) => svc.create({ title: "sync" }))),
    })

    const started = await app().request(SyncPaths.start, { method: "POST", headers })
    expect(started.status).toBe(200)
    expect(await started.json()).toBe(true)

    const history = await app().request(SyncPaths.history, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    expect(history.status).toBe(200)
    const rows = (await history.json()) as Array<{
      id: string
      aggregate_id: string
      seq: number
      type: string
      data: Record<string, unknown>
    }>
    expect(rows.map((row) => row.aggregate_id)).toContain(session.id)

    const replayed = await app().request(SyncPaths.replay, {
      method: "POST",
      headers,
      body: JSON.stringify({
        directory: tmp.path,
        events: rows
          .filter((row) => row.aggregate_id === session.id)
          .map((row) => ({
            id: row.id,
            aggregateID: row.aggregate_id,
            seq: row.seq,
            type: row.type,
            data: row.data,
          })),
      }),
    })
    expect(replayed.status).toBe(200)
    expect(await replayed.json()).toEqual({ sessionID: session.id })
  })

  test("matches legacy seq validation", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const cases = [
      {
        path: SyncPaths.history,
        body: { aggregate: -1 },
      },
      {
        path: SyncPaths.history,
        body: { aggregate: 1.5 },
      },
      {
        path: SyncPaths.replay,
        body: {
          directory: tmp.path,
          events: [{ id: "event", aggregateID: "session", seq: -1, type: "session.created", data: {} }],
        },
      },
      {
        path: SyncPaths.replay,
        body: {
          directory: tmp.path,
          events: [{ id: "event", aggregateID: "session", seq: 1.5, type: "session.created", data: {} }],
        },
      },
    ]

    for (const item of cases) {
      const legacy = await app(false).request(item.path, {
        method: "POST",
        headers,
        body: JSON.stringify(item.body),
      })
      const httpapi = await app(true).request(item.path, {
        method: "POST",
        headers,
        body: JSON.stringify(item.body),
      })
      expect(httpapi.status).toBe(legacy.status)
      expect(httpapi.status).toBe(400)
    }
  })
})
