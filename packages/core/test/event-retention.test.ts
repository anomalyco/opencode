import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { Duration, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventRetention } from "@opencode-ai/core/event/retention"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectSchema } from "@opencode-ai/core/project/schema"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { testEffect } from "./lib/effect"

const databaseLayer = Database.layerFromPath(":memory:")
const testLayer = Layer.mergeAll(EventV2.layer, EventRetention.layer, databaseLayer).pipe(
  Layer.provideMerge(databaseLayer),
)
const it = testEffect(testLayer)

const projectID = ProjectSchema.ID.make("prj_retention")
const directory = AbsolutePath.make("/tmp/event-retention-test")

const seedSession = (sessionID: SessionSchema.ID, timeUpdated: number) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values([
        { id: projectID, worktree: directory, sandboxes: [], time_created: timeUpdated, time_updated: timeUpdated },
      ])
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values([
        {
          id: sessionID,
          project_id: projectID,
          slug: sessionID,
          directory,
          title: "retention test",
          version: "0.0.0",
          time_created: timeUpdated,
          time_updated: timeUpdated,
        },
      ])
      .run()
      .pipe(Effect.orDie)
  })

const textPart = (
  sessionID: SessionSchema.ID,
  messageID: string,
  partID: string,
  text: string,
): SessionV1.TextPart => ({
  id: SessionV1.PartID.make(partID),
  sessionID,
  messageID: SessionV1.MessageID.make(messageID),
  type: "text",
  text,
})

const publishPartUpdated = (sessionID: SessionSchema.ID, partID: string, text: string) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    yield* events.publish(SessionV1.Event.PartUpdated, {
      sessionID,
      part: textPart(sessionID, "msg_retention", partID, text),
      time: 1,
    })
  })

const journal = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)
  })

const sequence = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select()
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, sessionID))
      .get()
      .pipe(Effect.orDie)
  })

describe("EventRetention", () => {
  it.live("sweep prunes the journal for sessions idle past the retention window", () =>
    Effect.gen(function* () {
      const now = Date.now()
      const stale = SessionSchema.ID.make("ses_retention_stale")
      const fresh = SessionSchema.ID.make("ses_retention_fresh")
      yield* seedSession(stale, now - Duration.toMillis(Duration.hours(EventRetention.RETENTION_HOURS + 1)))
      yield* seedSession(fresh, now - Duration.toMillis(Duration.minutes(1)))
      yield* publishPartUpdated(stale, "prt_a", "hello")
      yield* publishPartUpdated(stale, "prt_a", "hello world")
      yield* publishPartUpdated(fresh, "prt_b", "hi")
      yield* publishPartUpdated(fresh, "prt_b", "hi there")

      const retention = yield* EventRetention.Service
      const result = yield* retention.sweep()

      expect(result.prunedSessions).toBe(1)
      expect(result.prunedEvents).toBe(2)
      expect(yield* journal(stale)).toEqual([])
      expect(yield* sequence(stale)).toBeUndefined()
      // fresh session is neither pruned nor compacted (idle for under a minute)
      expect(result.compactedSessions).toBe(0)
      expect((yield* journal(fresh)).length).toBe(2)
      expect((yield* sequence(fresh))?.seq).toBe(1)
    }),
  )

  it.live("sweep compacts redundant part.updated events for idle sessions and resequences", () =>
    Effect.gen(function* () {
      const now = Date.now()
      const idle = SessionSchema.ID.make("ses_retention_idle")
      yield* seedSession(idle, now - Duration.toMillis(Duration.hours(2)))
      yield* publishPartUpdated(idle, "prt_a", "h") // seq 0
      yield* publishPartUpdated(idle, "prt_a", "he") // seq 1
      yield* publishPartUpdated(idle, "prt_b", "x") // seq 2
      yield* publishPartUpdated(idle, "prt_a", "hey") // seq 3
      const events = yield* EventV2.Service
      yield* events.publish(SessionV1.Event.PartRemoved, {
        sessionID: idle,
        messageID: SessionV1.MessageID.make("msg_retention"),
        partID: SessionV1.PartID.make("prt_b"),
      }) // seq 4

      const retention = yield* EventRetention.Service
      const result = yield* retention.sweep()

      expect(result.compactedSessions).toBe(1)
      expect(result.compactedEvents).toBe(2)

      const rows = yield* journal(idle)
      expect(rows.map((row) => row.seq)).toEqual([0, 1, 2])
      expect(rows.map((row) => row.type)).toEqual([
        "message.part.updated.1",
        "message.part.updated.1",
        "message.part.removed.1",
      ])
      // survivors keep their original relative order: prt_b's last update
      // (old seq 2) before prt_a's last update (old seq 3)
      expect((rows[0].data as { part: { id: string } }).part.id).toBe("prt_b")
      expect((rows[1].data as { part: { id: string; text: string } }).part.text).toBe("hey")
      expect((yield* sequence(idle))?.seq).toBe(2)

      // appends after compaction continue from the realigned counter
      yield* publishPartUpdated(idle, "prt_c", "new")
      const appended = yield* journal(idle)
      expect(appended.at(-1)?.seq).toBe(3)
    }),
  )

  it.live("compacted journals replay contiguously into a fresh database", () =>
    Effect.gen(function* () {
      const now = Date.now()
      const idle = SessionSchema.ID.make("ses_retention_replay")
      yield* seedSession(idle, now - Duration.toMillis(Duration.hours(2)))
      yield* publishPartUpdated(idle, "prt_a", "h")
      yield* publishPartUpdated(idle, "prt_a", "he")
      yield* publishPartUpdated(idle, "prt_a", "hello")
      yield* publishPartUpdated(idle, "prt_b", "world")

      const retention = yield* EventRetention.Service
      yield* retention.sweep()

      const rows = yield* journal(idle)
      const serialized = rows.map((row) => ({
        id: row.id,
        aggregateID: row.aggregate_id,
        seq: row.seq,
        type: row.type,
        data: row.data,
      }))

      const freshDatabase = Database.layerFromPath(":memory:")
      const fresh = Layer.mergeAll(EventV2.layer, freshDatabase).pipe(Layer.provideMerge(freshDatabase))
      yield* Effect.gen(function* () {
        const events = yield* EventV2.Service
        yield* events.replayAll(serialized)
        const { db } = yield* Database.Service
        const replayed = yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, idle))
          .orderBy(asc(EventTable.seq))
          .all()
          .pipe(Effect.orDie)
        expect(replayed.map((row) => row.seq)).toEqual([0, 1])
        expect((replayed[0].data as { part: { text: string } }).part.text).toBe("hello")
      }).pipe(Effect.provide(fresh), Effect.scoped)
    }),
  )

  it.live("sweep is idempotent and skips journals with nothing redundant", () =>
    Effect.gen(function* () {
      const now = Date.now()
      const idle = SessionSchema.ID.make("ses_retention_noop")
      yield* seedSession(idle, now - Duration.toMillis(Duration.hours(2)))
      yield* publishPartUpdated(idle, "prt_a", "only")
      yield* publishPartUpdated(idle, "prt_b", "final")

      const retention = yield* EventRetention.Service
      const first = yield* retention.sweep()
      expect(first.prunedSessions).toBe(0)
      expect(first.compactedSessions).toBe(0)

      const before = yield* journal(idle)
      const second = yield* retention.sweep()
      expect(second).toEqual({ prunedSessions: 0, prunedEvents: 0, compactedSessions: 0, compactedEvents: 0 })
      expect(yield* journal(idle)).toEqual(before)
      expect((yield* sequence(idle))?.seq).toBe(1)
    }),
  )
})
