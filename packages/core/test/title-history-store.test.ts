import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable, SessionTitleHistoryTable } from "@opencode-ai/core/session/sql"
import { TitleHistoryStore } from "@opencode-ai/core/session/title-history-store"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, TitleHistoryStore.node])))

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

describe("TitleHistoryStore", () => {
  it.effect("inserts and lists title entries", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* TitleHistoryStore.Service

      yield* store.insert({
        sessionID,
        title: "Fix the login bug",
        source: "llm",
        model: "openrouter/anthropic/claude-haiku-4.5",
        triggerMessageID: "msg_1" as never,
      })
      yield* store.insert({ sessionID, title: "Login hotfix", source: "user" })

      const rows = yield* store.listBySession(sessionID)
      expect(rows).toHaveLength(2)
      expect(rows[0].id.startsWith("tih_")).toBe(true)
      expect(rows[0].sessionID).toBe(sessionID)
      expect(rows[0].title).toBe("Fix the login bug")
      expect(rows[0].source).toBe("llm")
      expect(rows[0].model).toBe("openrouter/anthropic/claude-haiku-4.5")
      expect(rows[0].triggerMessageID).toBe("msg_1" as never)
      expect(rows[0].createdAt).toBeNumber()
      expect(rows[1].title).toBe("Login hotfix")
      expect(rows[1].source).toBe("user")
      expect(rows[1].model).toBeUndefined()
      expect(rows[1].triggerMessageID).toBeUndefined()
    }),
  )

  it.effect("lists entries ordered by created_at", () =>
    Effect.gen(function* () {
      yield* seed
      const db = (yield* Database.Service).db
      yield* Effect.forEach(
        [
          { id: "tih_c", created_at: 300 },
          { id: "tih_a", created_at: 100 },
          { id: "tih_b", created_at: 200 },
        ],
        (row) =>
          db
            .insert(SessionTitleHistoryTable)
            .values({
              id: row.id,
              session_id: sessionID,
              title: `title ${row.id}`,
              source: "user",
              created_at: row.created_at,
            })
            .run()
            .pipe(Effect.orDie),
      )
      const store = yield* TitleHistoryStore.Service

      const rows = yield* store.listBySession(sessionID)
      expect(rows.map((row) => row.id)).toEqual(["tih_a", "tih_b", "tih_c"])
    }),
  )

  it.effect("cascades when the session is deleted", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* TitleHistoryStore.Service
      yield* store.insert({ sessionID, title: "title", source: "user" })
      expect(yield* store.listBySession(sessionID)).toHaveLength(1)

      const db = (yield* Database.Service).db
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      expect(yield* store.listBySession(sessionID)).toHaveLength(0)
    }),
  )
})
