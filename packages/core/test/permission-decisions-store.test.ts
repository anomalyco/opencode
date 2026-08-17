import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { PermissionDecisionsTable, SessionTable } from "@opencode-ai/core/session/sql"
import { PermissionDecisionsStore } from "@opencode-ai/core/session/permission-decisions-store"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, PermissionDecisionsStore.node])))

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

describe("PermissionDecisionsStore", () => {
  it.effect("inserts and lists decisions", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* PermissionDecisionsStore.Service

      yield* store.insert({
        sessionID,
        permission: "bash",
        patterns: ["rm -rf /tmp/build"],
        metadata: { callID: "call-1", cwd: "/project" },
        verdict: "deny",
        reason: "destructive command",
        model: "openrouter/anthropic/claude-haiku-4.5",
        latencyMs: 812,
      })
      yield* store.insert({
        sessionID,
        permission: "edit",
        patterns: ["src/index.ts"],
        verdict: "allow",
        model: "openrouter/anthropic/claude-haiku-4.5",
        latencyMs: 405,
      })

      const rows = yield* store.listBySession(sessionID)
      expect(rows).toHaveLength(2)
      expect(rows[0].id.startsWith("dec_")).toBe(true)
      expect(rows[0].sessionID).toBe(sessionID)
      expect(rows[0].permission).toBe("bash")
      expect(rows[0].patterns).toEqual(["<redacted:1>"])
      expect(rows[0].metadata).toEqual({ callID: "call-1" })
      expect(rows[0].verdict).toBe("deny")
      expect(rows[0].reason).toBe("destructive command")
      expect(rows[0].model).toBe("openrouter/anthropic/claude-haiku-4.5")
      expect(rows[0].latencyMs).toBe(812)
      expect(rows[0].createdAt).toBeNumber()
      expect(rows[1].verdict).toBe("allow")
      expect(rows[1].metadata).toBeUndefined()
      expect(rows[1].reason).toBeUndefined()
    }),
  )

  it.effect("lists decisions ordered by created_at", () =>
    Effect.gen(function* () {
      yield* seed
      const db = (yield* Database.Service).db
      yield* Effect.forEach(
        [
          { id: "dec_c", created_at: 300 },
          { id: "dec_a", created_at: 100 },
          { id: "dec_b", created_at: 200 },
        ],
        (row) =>
          db
            .insert(PermissionDecisionsTable)
            .values({
              id: row.id,
              session_id: sessionID,
              permission: "bash",
              patterns: ["ls"],
              verdict: "allow",
              model: "test/model",
              latency_ms: 1,
              created_at: row.created_at,
            })
            .run()
            .pipe(Effect.orDie),
      )
      const store = yield* PermissionDecisionsStore.Service

      const rows = yield* store.listBySession(sessionID)
      expect(rows.map((row) => row.id)).toEqual(["dec_a", "dec_b", "dec_c"])
    }),
  )

  it.effect("cascades when the session is deleted", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* PermissionDecisionsStore.Service
      yield* store.insert({
        sessionID,
        permission: "bash",
        patterns: ["ls"],
        verdict: "allow",
        model: "test/model",
        latencyMs: 1,
      })
      expect(yield* store.listBySession(sessionID)).toHaveLength(1)

      const db = (yield* Database.Service).db
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      expect(yield* store.listBySession(sessionID)).toHaveLength(0)
    }),
  )
})
