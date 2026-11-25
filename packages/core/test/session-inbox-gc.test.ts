import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionTable, SessionInboxTable } from "@opencode/core/session/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { testEffect } from "./lib/effect"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionInbox.node]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)

const sessionID = Session.ID.make("ses_inbox_gc_test")
const DAY_MS = 24 * 60 * 60 * 1000
const TTL = 7 * DAY_MS

const seedSession = () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
      })
      .run()
    return db
  })

const steerRow = (id: SessionMessage.ID, type: "synthetic" | "user", ageMs: number, seq: number) => ({
  id,
  session_id: sessionID,
  type,
  payload:
    type === "synthetic"
      ? { text: "Shell result notification", description: "stale command" }
      : { text: "steered user prompt" },
  delivery: "steer" as const,
  enqueued_seq: seq,
  time_created: Date.now() - ageMs,
})

describe("SessionInbox.gcStaleSteers", () => {
  it.effect("deletes only stale synthetic steers: fresh steers, user steers, queue rows and controls survive", () =>
    Effect.gen(function* () {
      const db = yield* seedSession()
      const staleSynthetic = SessionMessage.ID.make("msg_gc_stale_synthetic")
      const freshSynthetic = SessionMessage.ID.make("msg_gc_fresh_synthetic")
      const staleUser = SessionMessage.ID.make("msg_gc_stale_user")
      const staleQueue = SessionMessage.ID.make("msg_gc_stale_queue")
      const staleCompaction = SessionMessage.ID.make("msg_gc_stale_compaction")
      yield* db
        .insert(SessionInboxTable)
        .values([
          steerRow(staleSynthetic, "synthetic", TTL + DAY_MS, 0),
          steerRow(freshSynthetic, "synthetic", DAY_MS, 1),
          steerRow(staleUser, "user", TTL + DAY_MS, 2),
          {
            id: staleQueue,
            session_id: sessionID,
            type: "synthetic" as const,
            payload: { text: "queued notice" },
            delivery: "queue" as const,
            enqueued_seq: 3,
            time_created: Date.now() - (TTL + DAY_MS),
          },
          {
            id: staleCompaction,
            session_id: sessionID,
            type: "compaction" as const,
            payload: {},
            delivery: "steer" as const,
            enqueued_seq: 4,
            time_created: Date.now() - (TTL + DAY_MS),
          },
        ])
      const inbox = yield* SessionInbox.Service

      const deleted = yield* inbox.gcStaleSteers(TTL)

      expect(deleted).toEqual([staleSynthetic])
      expect(yield* SessionInbox.find(db, staleSynthetic)).toBeUndefined()
      for (const kept of [freshSynthetic, staleUser, staleQueue, staleCompaction])
        expect((yield* SessionInbox.find(db, kept))?.id).toBe(kept)
      expect(yield* db.select().from(SessionInboxTable).where(eq(SessionInboxTable.session_id, sessionID))).toHaveLength(4)
    }),
  )
})
