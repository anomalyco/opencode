import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Context, Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const context = Context.empty() as Context.Context<unknown>

function app() {
  return Server.Default().app
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("sync HttpApi", () => {
  test("serves sync routes", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const info = spyOn(Log.create({ service: "server.sync" }), "info")

    const session = await WithInstance.provide({
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
    expect(info.mock.calls.some(([message]) => message === "sync replay requested")).toBe(true)
    expect(info.mock.calls.some(([message]) => message === "sync replay complete")).toBe(true)
  })

  test("validates seq values", async () => {
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
      const response = await app().request(item.path, {
        method: "POST",
        headers,
        body: JSON.stringify(item.body),
      })
      expect(response.status).toBe(400)
    }
  })

  test.todo("returns structured validation errors", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await ExperimentalHttpApiServer.webHandler().handler(
      new Request(`http://localhost${SyncPaths.history}`, {
        method: "POST",
        headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
        body: JSON.stringify({ aggregate: -1 }),
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = (await response.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect(Array.isArray(body.error) || Array.isArray(body.errors)).toBe(true)
  })
})
