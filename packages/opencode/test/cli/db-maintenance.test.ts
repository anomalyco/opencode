import { describe, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { dbStats, pruneOrphanedEvents } from "@/cli/cmd/db"

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

describe("db vacuum", () => {
  test("reclaims free pages after deletion", () =>
    run(
      Effect.gen(function* () {
        const db = yield* makeDb

        yield* db.run(sql`CREATE TABLE IF NOT EXISTS junk (id TEXT PRIMARY KEY, data TEXT)`)
        for (let i = 0; i < 100; i++) {
          yield* db.run(sql`INSERT INTO junk (id, data) VALUES (${'junk_' + i}, ${'x'.repeat(4000)})`)
        }

        const beforePages = yield* db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        expect(beforePages?.page_count).toBeGreaterThan(10)

        yield* db.run(sql`DELETE FROM junk`)

        const afterDelete = yield* db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
        expect(afterDelete?.freelist_count).toBeGreaterThan(0)

        yield* db.run(sql`VACUUM`)

        const afterVacuumPages = yield* db.get<{ page_count: number }>(sql`PRAGMA page_count`)
        expect(afterVacuumPages?.page_count).toBeLessThan(beforePages!.page_count)
      }),
    ),
  )
})
