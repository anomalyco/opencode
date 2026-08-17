import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { AutoSummaryStore } from "@opencode-ai/core/session/auto-summary-store"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, AutoSummaryStore.node])))

const projectID = "prj_test" as never
const sessionID = "ses_test" as never

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: "/project" as never, sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "test",
      directory: "/project",
      title: "test session",
      version: "0.0.0",
    })
    .run()
    .pipe(Effect.orDie)
})

describe("AutoSummaryStore", () => {
  it.effect("returns undefined when no summary exists", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* AutoSummaryStore.Service
      expect(yield* store.get(sessionID)).toBeUndefined()
    }),
  )

  it.effect("upserts and gets the summary", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* AutoSummaryStore.Service

      yield* store.upsert({ sessionID, summary: "did X, tested Y", model: "test/model", turnCount: 3 })
      const row = yield* store.get(sessionID)
      expect(row?.sessionID).toBe(sessionID)
      expect(row?.summary).toBe("did X, tested Y")
      expect(row?.model).toBe("test/model")
      expect(row?.turnCount).toBe(3)
      expect(row?.updatedAt).toBeNumber()
    }),
  )

  it.effect("upsert is idempotent and keeps a single row per session", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* AutoSummaryStore.Service

      const input = { sessionID, summary: "did X", model: "test/model", turnCount: 1 }
      yield* store.upsert(input)
      yield* store.upsert(input)
      expect((yield* store.get(sessionID))?.summary).toBe("did X")

      yield* store.upsert({ sessionID, summary: "did X then Z", model: "test/model", turnCount: 2 })
      const row = yield* store.get(sessionID)
      expect(row?.summary).toBe("did X then Z")
      expect(row?.turnCount).toBe(2)
    }),
  )

  it.effect("cascades when the session is deleted", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* AutoSummaryStore.Service
      yield* store.upsert({ sessionID, summary: "did X", model: "test/model", turnCount: 1 })
      expect(yield* store.get(sessionID)).toBeDefined()

      const db = (yield* Database.Service).db
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      expect(yield* store.get(sessionID)).toBeUndefined()
    }),
  )
})
