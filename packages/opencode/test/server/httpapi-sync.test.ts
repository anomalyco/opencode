import { afterEach, describe, expect, mock } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { SYNC_HISTORY_LIMIT } from "../../src/control-plane/workspace"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const originalWorkspaceID = Flag.OPENCODE_WORKSPACE_ID
const context = Context.empty() as Context.Context<unknown>
const it = testEffect(Layer.mergeAll(LayerNode.compile(LayerNode.group([Session.node, Database.node])), httpApiLayer))

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  Flag.OPENCODE_WORKSPACE_ID = originalWorkspaceID
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
        const session = yield* Session.use.create({ title: "sync" })

        const started = yield* requestInDirectory(SyncPaths.start, tmp.directory, { method: "POST", headers })
        expect(started.status).toBe(200)
        expect(yield* started.json).toBe(true)

        // Listing an unrelated aggregate leaves the session's own aggregate
        // unlisted, so its full history (including seq 0) is returned.
        const history = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ ses_other_aggregate: 0 }),
        })
        expect(history.status).toBe(200)
        const rows = (yield* history.json) as Array<{
          id: string
          aggregate_id: string
          seq: number
          type: string
          data: Record<string, unknown>
        }>
        expect(rows.map((row) => row.aggregate_id)).toContain(session.id)

        const replayed = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
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
        })
        expect(replayed.status).toBe(200)
        expect(yield* replayed.json).toEqual({ sessionID: session.id })
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
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: 0, type: "session.created", data: {} }],
            },
          },
        ]

        for (const item of cases) {
          const response = yield* requestInDirectory(item.path, tmp.directory, {
            method: "POST",
            headers,
            body: JSON.stringify(item.body),
          })
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
          HttpApiApp.webHandler().handler(
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

  it.instance(
    "rejects a replay with no events",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const response = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ directory: tmp.directory, events: [] }),
        })
        expect(response.status).toBe(400)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "bounds a single history page",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const { db } = yield* Database.Service
        const aggregate = "session_limit_page"
        yield* db
          .insert(EventSequenceTable)
          .values({ aggregate_id: aggregate, seq: SYNC_HISTORY_LIMIT + 1 })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(EventTable)
          .values(
            Array.from({ length: SYNC_HISTORY_LIMIT + 1 }, (_, index) => ({
              id: EventV2.ID.make(`evt_limit_${index}`),
              aggregate_id: aggregate,
              seq: index + 1,
              type: "test.limit",
              data: {},
            })),
          )
          .run()
          .pipe(Effect.orDie)

        const response = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ [aggregate]: 0 }),
        })
        expect(response.status).toBe(200)
        const rows = (yield* response.json) as Array<{ seq: number }>
        expect(rows).toHaveLength(SYNC_HISTORY_LIMIT)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns no events for an empty history map",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        yield* Session.use.create({ title: "empty-history" })

        const response = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects a history map over the key bound",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const body = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`ses_${index}`, 0]))

        const response = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
        expect(response.status).toBe(400)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects stealing a session that does not exist",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        Flag.OPENCODE_WORKSPACE_ID = "wrk_steal_missing"
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }

        const response = yield* requestInDirectory(SyncPaths.steal, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionID: "ses_does_not_exist" }),
        })
        expect(response.status).toBe(404)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects stealing a session owned by another project",
    () =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        Flag.OPENCODE_WORKSPACE_ID = "wrk_steal_other"
        const tmp = yield* TestInstance
        const headers = { "x-opencode-directory": tmp.directory, "content-type": "application/json" }
        const { db } = yield* Database.Service
        const otherProject = ProjectV2.ID.make("proj_other_steal")
        yield* db
          .insert(ProjectTable)
          .values({
            id: otherProject,
            worktree: AbsolutePath.make("/tmp/other-project"),
            sandboxes: [],
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run()
          .pipe(Effect.orDie)
        const session = yield* Session.use.create({ title: "other-project" })
        yield* db
          .update(SessionTable)
          .set({ project_id: otherProject })
          .where(eq(SessionTable.id, session.id))
          .run()
          .pipe(Effect.orDie)

        const response = yield* requestInDirectory(SyncPaths.steal, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionID: session.id }),
        })
        expect(response.status).toBe(403)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
