import { describe, expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/core/database/drizzle"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import executionClaimMigration from "@opencode-ai/core/database/migration/20260903010538_execution_claimed_at"
import { Global } from "@opencode-ai/util/global"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(
    SqliteClient.layer({ filename: ":memory:", disableWAL: true }),
    Layer.succeed(Global.Service, Global.make()),
  ),
)

describe("execution claim column", () => {
  it.live("bootstraps the renamed column with an unclaimed default and its partial index", () =>
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* DatabaseMigration.apply(db)
      yield* db.run(sql`
        INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
        VALUES ('project', '/repo', 1, 2, '[]')
      `)
      yield* db.run(sql`
        INSERT INTO session_v2 (id, project_id, slug, directory, version, time_created, time_updated)
        VALUES ('session', 'project', 'session', '/repo', '2', 1, 2)
      `)

      expect(yield* db.get(sql`SELECT execution_claimed_at, resume_attempts FROM session_v2`)).toEqual({
        execution_claimed_at: null,
        resume_attempts: 0,
      })
      expect(yield* db.get(sql`SELECT id FROM migration WHERE id = ${executionClaimMigration.id}`)).toEqual({
        id: executionClaimMigration.id,
      })
      expect(
        yield* db.all(sql`SELECT name FROM pragma_table_info('session_v2') WHERE name = 'time_suspended'`),
      ).toEqual([])
      expect(
        yield* db.get(sql`
          SELECT name, partial FROM pragma_index_list('session_v2')
          WHERE name = 'session_v2_execution_claimed_at_idx'
        `),
      ).toEqual({ name: "session_v2_execution_claimed_at_idx", partial: 1 })
      expect(yield* db.all(sql`SELECT name FROM pragma_index_info('session_v2_execution_claimed_at_idx')`)).toEqual([
        { name: "execution_claimed_at" },
      ])
      yield* DatabaseMigration.apply(db)
    }),
  )

  it.live("migrates existing claims without resetting attempts, activity, or dependent history", () =>
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* db.run(sql`PRAGMA foreign_keys = ON`)
      yield* db.run(sql`
        CREATE TABLE session_v2 (
          id text PRIMARY KEY,
          parent_id text,
          title text,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          time_suspended integer,
          resume_attempts integer DEFAULT 0 NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE INDEX session_v2_time_suspended_idx ON session_v2 (time_suspended)
        WHERE "session_v2"."time_suspended" IS NOT NULL
      `)
      yield* db.run(sql`
        CREATE TABLE session_message (
          id text PRIMARY KEY,
          session_id text NOT NULL REFERENCES session_v2(id) ON DELETE CASCADE,
          data text NOT NULL
        )
      `)
      yield* db.run(sql`
        INSERT INTO session_v2 VALUES
          ('claimed', NULL, 'Claimed', 1, 2, 1234, 2),
          ('child', 'claimed', 'Child', 3, 4, 5678, 1),
          ('idle', NULL, 'Idle', 5, 6, NULL, 0)
      `)
      yield* db.run(sql`INSERT INTO session_message VALUES ('message', 'claimed', '{"text":"preserved"}')`)
      yield* db.run(sql`CREATE TABLE migration (id text PRIMARY KEY, time_completed integer NOT NULL)`)
      yield* Effect.forEach(
        migrations.filter((migration) => migration.id !== executionClaimMigration.id),
        (migration) => db.run(sql`INSERT INTO migration VALUES (${migration.id}, 1)`),
      )

      yield* DatabaseMigration.apply(db)
      yield* DatabaseMigration.apply(db)

      expect(yield* db.all(sql`SELECT * FROM session_v2 ORDER BY id`)).toEqual([
        {
          id: "child",
          parent_id: "claimed",
          title: "Child",
          time_created: 3,
          time_updated: 4,
          execution_claimed_at: 5678,
          resume_attempts: 1,
        },
        {
          id: "claimed",
          parent_id: null,
          title: "Claimed",
          time_created: 1,
          time_updated: 2,
          execution_claimed_at: 1234,
          resume_attempts: 2,
        },
        {
          id: "idle",
          parent_id: null,
          title: "Idle",
          time_created: 5,
          time_updated: 6,
          execution_claimed_at: null,
          resume_attempts: 0,
        },
      ])
      expect(yield* db.all(sql`SELECT * FROM session_message`)).toEqual([
        { id: "message", session_id: "claimed", data: '{"text":"preserved"}' },
      ])
      expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
      expect(yield* db.get(sql`SELECT count(*) AS count FROM migration`)).toEqual({ count: migrations.length })
      expect(
        yield* db.all(sql`
          SELECT name FROM pragma_index_list('session_v2') WHERE name = 'session_v2_time_suspended_idx'
        `),
      ).toEqual([])
      expect(
        yield* db.all(sql`
          SELECT id FROM session_v2 INDEXED BY session_v2_execution_claimed_at_idx
          WHERE execution_claimed_at IS NOT NULL ORDER BY id
        `),
      ).toEqual([{ id: "child" }, { id: "claimed" }])
    }),
  )
})
