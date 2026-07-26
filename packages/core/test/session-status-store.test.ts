import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStatusStore } from "@opencode-ai/core/session/status-store"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, SessionStatusStore.node])))

const projectID = "prj_test" as never
const sessionID = "ses_test" as never

const seed = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  yield* db.insert(ProjectTable).values({ id: projectID, worktree: "/project", sandboxes: [] }).run().pipe(Effect.orDie)
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

function addMessage(data: Record<string, unknown>) {
  return Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(MessageTable)
      .values({ id: `msg_${Date.now()}` as never, session_id: sessionID, data })
      .run()
      .pipe(Effect.orDie)
  })
}

function addTextPart(text: string) {
  return Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const message = yield* db
      .select()
      .from(MessageTable)
      .where(eq(MessageTable.session_id, sessionID))
      .get()
      .pipe(Effect.orDie)
    yield* db
      .insert(PartTable)
      .values({
        id: `prt_${Date.now()}` as never,
        message_id: message!.id,
        session_id: sessionID,
        data: { type: "text", text },
      })
      .run()
      .pipe(Effect.orDie)
  })
}

describe("SessionStatusStore", () => {
  it.effect("writes, dedupes, and lists statuses", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* SessionStatusStore.Service

      yield* store.set(sessionID, "working")
      const first = (yield* store.list())[0]
      expect(first.status).toBe("working")

      // Rewriting the same status+detail keeps the original change timestamp
      yield* store.set(sessionID, "working")
      expect((yield* store.list())[0].time.updated).toBe(first.time.updated)

      yield* store.set(sessionID, "needs_input", "Approve?")
      const updated = (yield* store.list())[0]
      expect(updated.status).toBe("needs_input")
      expect(updated.detail).toBe("Approve?")
    }),
  )

  it.effect("marks done with the first line of the last assistant text", () =>
    Effect.gen(function* () {
      yield* seed
      yield* addMessage({ role: "assistant", time: { created: 1, completed: 2 } })
      yield* addTextPart("Here is the summary\nwith more detail below")
      const store = yield* SessionStatusStore.Service

      yield* store.setIdle(sessionID)
      const row = (yield* store.list())[0]
      expect(row.status).toBe("done")
      expect(row.detail).toBe("Here is the summary")
    }),
  )

  it.effect("marks plain idle when the turn was not completed", () =>
    Effect.gen(function* () {
      yield* seed
      yield* addMessage({ role: "assistant", time: { created: 1 } })
      const store = yield* SessionStatusStore.Service

      yield* store.setIdle(sessionID)
      expect((yield* store.list())[0].status).toBe("idle")
    }),
  )

  it.effect("marks plain idle when the user spoke last", () =>
    Effect.gen(function* () {
      yield* seed
      yield* addMessage({ role: "user", time: { created: 1 } })
      const store = yield* SessionStatusStore.Service

      yield* store.setIdle(sessionID)
      expect((yield* store.list())[0].status).toBe("idle")
    }),
  )

  it.effect("cascades when the session is deleted", () =>
    Effect.gen(function* () {
      yield* seed
      const store = yield* SessionStatusStore.Service
      yield* store.set(sessionID, "working")
      expect(yield* store.list()).toHaveLength(1)

      const db = (yield* Database.Service).db
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
      expect(yield* store.list()).toHaveLength(0)
    }),
  )
})
