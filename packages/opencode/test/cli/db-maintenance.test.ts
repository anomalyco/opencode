import { describe, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { dbStats, pruneOrphanedEvents, pruneOldSessions } from "@/cli/cmd/db"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true }))))

const makeDb = Effect.gen(function* () {
  return yield* EffectDrizzleSqlite.makeWithDefaults()
})

describe("db stats", () => {
  test("returns table row counts and database file size", () =>
    run(
      Effect.gen(function* () {
        const db = yield* makeDb

        yield* db.run(sql`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT)`,
        )
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT)`,
        )
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)`,
        )
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`,
        )

        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_test1')`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_1', 'ses_test1', 0, 'session.created.1', '{}')`,
        )
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_test1', 1)`)

        const stats = yield* dbStats(db)

        expect(stats.tables.session).toBe(1)
        expect(stats.tables.event).toBe(1)
        expect(stats.tables.event_sequence).toBe(1)
        expect(stats.pageCount).toBeGreaterThan(0)
        expect(stats.pageSize).toBe(4096)
        expect(stats.freelistCount).toBeGreaterThanOrEqual(0)
      }),
    ),
  )
})

describe("db prune orphaned events", () => {
  test("removes event rows for sessions that no longer exist", () =>
    run(
      Effect.gen(function* () {
        const db = yield* makeDb

        yield* db.run(sql`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT)`,
        )
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT)`,
        )

        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_alive')`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_1', 'ses_alive', 0, 'x', '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_2', 'ses_dead', 0, 'x', '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_3', 'ses_dead', 1, 'x', '{}')`,
        )
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_alive', 1)`)
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_dead', 2)`)

        const result = yield* pruneOrphanedEvents(db)

        expect(result.eventsDeleted).toBe(2)
        expect(result.sequencesDeleted).toBe(1)

        const remaining = yield* db.all<{ aggregate_id: string }>(sql`SELECT aggregate_id FROM event`)
        expect(remaining).toHaveLength(1)
        expect(remaining[0].aggregate_id).toBe("ses_alive")

        const remainingSeq = yield* db.all<{ aggregate_id: string }>(
          sql`SELECT aggregate_id FROM event_sequence`,
        )
        expect(remainingSeq).toHaveLength(1)
        expect(remainingSeq[0].aggregate_id).toBe("ses_alive")
      }),
    ),
  )

  test("does not remove events for sessions that still exist", () =>
    run(
      Effect.gen(function* () {
        const db = yield* makeDb

        yield* db.run(sql`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT)`,
        )
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT)`,
        )

        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_a')`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_1', 'ses_a', 0, 'x', '{}')`,
        )
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_a', 1)`)

        const result = yield* pruneOrphanedEvents(db)

        expect(result.eventsDeleted).toBe(0)
        expect(result.sequencesDeleted).toBe(0)
      }),
    ),
  )
})

describe("db prune old sessions", () => {
  test("deletes sessions older than max-age and their events", () =>
    run(
      Effect.gen(function* () {
        const db = yield* makeDb

        yield* db.run(sql`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER)`)
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT)`,
        )
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT)`,
        )

        const now = Date.now()
        const old = now - 40 * 24 * 60 * 60 * 1000

        yield* db.run(sql`INSERT INTO session (id, time_created, time_updated) VALUES ('ses_old', ${old}, ${old})`)
        yield* db.run(sql`INSERT INTO session (id, time_created, time_updated) VALUES ('ses_new', ${now}, ${now})`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_1', 'ses_old', 0, 'x', '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_2', 'ses_new', 0, 'x', '{}')`,
        )
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_old', 1)`)
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_new', 1)`)

        const result = yield* pruneOldSessions(db, 30)

        expect(result.sessionsDeleted).toBe(1)
        expect(result.eventsDeleted).toBe(1)
        expect(result.sequencesDeleted).toBe(1)

        const remaining = yield* db.all<{ id: string }>(sql`SELECT id FROM session`)
        expect(remaining).toHaveLength(1)
        expect(remaining[0].id).toBe("ses_new")
      }),
    ),
  )

  test("does not delete sessions within max-age", () =>
    run(
      Effect.gen(function* () {
        const db = yield* makeDb

        yield* db.run(sql`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER)`)
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT)`,
        )
        yield* db.run(
          sql`CREATE TABLE IF NOT EXISTS event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER, owner_id TEXT)`,
        )

        const now = Date.now()
        const recent = now - 5 * 24 * 60 * 60 * 1000

        yield* db.run(sql`INSERT INTO session (id, time_created, time_updated) VALUES ('ses_recent', ${recent}, ${recent})`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_1', 'ses_recent', 0, 'x', '{}')`,
        )
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_recent', 1)`)

        const result = yield* pruneOldSessions(db, 30)

        expect(result.sessionsDeleted).toBe(0)
        expect(result.eventsDeleted).toBe(0)
        expect(result.sequencesDeleted).toBe(0)
      }),
    ),
  )
})
