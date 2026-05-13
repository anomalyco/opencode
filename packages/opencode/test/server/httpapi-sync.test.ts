import { afterEach, describe, expect, mock, spyOn } from "bun:test"
import { Context, Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const context = Context.empty() as Context.Context<unknown>
const it = testEffect(Session.defaultLayer)

function app() {
  return Server.Default().app
}

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("sync HttpApi", () => {
  it.instance(
    "serves sync routes",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const info = spyOn(Log.create({ service: "server.sync" }), "info")
        const session = yield* Session.Service.use((svc) => svc.create({ title: "sync" }))

        const started = yield* Effect.promise(() =>
          Promise.resolve(app().request(SyncPaths.start, { method: "POST", headers })),
        )
        expect(started.status).toBe(200)
        expect(yield* Effect.promise(() => started.json())).toBe(true)

        const history = yield* Effect.promise(() =>
          Promise.resolve(
            app().request(SyncPaths.history, {
              method: "POST",
              headers,
              body: JSON.stringify({}),
            }),
          ),
        )
        expect(history.status).toBe(200)
        const rows = (yield* Effect.promise(() => history.json())) as Array<{
          id: string
          aggregate_id: string
          seq: number
          type: string
          data: Record<string, unknown>
        }>
        expect(rows.map((row) => row.aggregate_id)).toContain(session.id)

        const replayed = yield* Effect.promise(() =>
          Promise.resolve(
            app().request(SyncPaths.replay, {
              method: "POST",
              headers,
              body: JSON.stringify({
                directory: tmp.directory,
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
            }),
          ),
        )
        expect(replayed.status).toBe(200)
        expect(yield* Effect.promise(() => replayed.json())).toEqual({ sessionID: session.id })
        expect(info.mock.calls.some(([message]) => message === "sync replay requested")).toBe(true)
        expect(info.mock.calls.some(([message]) => message === "sync replay complete")).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "validates seq values",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
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
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: -1, type: "session.created", data: {} }],
            },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: 1.5, type: "session.created", data: {} }],
            },
          },
        ]

        for (const item of cases) {
          const response = yield* Effect.promise(() =>
            Promise.resolve(
              app().request(item.path, {
                method: "POST",
                headers,
                body: JSON.stringify(item.body),
              }),
            ),
          )
          expect(response.status).toBe(400)
        }
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance.skip(
    "returns structured validation errors",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* Effect.promise(() =>
          ExperimentalHttpApiServer.webHandler().handler(
            new Request(`http://localhost${SyncPaths.history}`, {
              method: "POST",
              headers: { "x-opencode-directory": tmp.directory, "content-type": "application/json" },
              body: JSON.stringify({ aggregate: -1 }),
            }),
            context,
          ),
        )

        expect(response.status).toBe(400)
        expect(response.headers.get("content-type") ?? "").toContain("application/json")
        const body = (yield* Effect.promise(() => response.json())) as Record<string, unknown>
        expect(body.success).toBe(false)
        expect(Array.isArray(body.error) || Array.isArray(body.errors)).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
