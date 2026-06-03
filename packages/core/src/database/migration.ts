export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import type { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"
import { migrations } from "./migration.gen"
import { bootstrapPg } from "./pg-bootstrap"

type SqliteDatabase = EffectDrizzleSqlite.EffectSQLiteDatabase
type SqliteTransaction = Parameters<Parameters<SqliteDatabase["transaction"]>[0]>[0]

type PgDatabase = EffectDrizzlePg.EffectPgDatabase
type PgTransaction = Parameters<Parameters<PgDatabase["transaction"]>[0]>[0]

export type Migration = {
  id: string
  up: (tx: SqliteTransaction) => Effect.Effect<void, unknown>
  pgUp?: (tx: PgTransaction) => Effect.Effect<void, unknown>
}

export function applySqlite(db: SqliteDatabase) {
  return applyOnly(db, migrations)
}

export const apply = applySqlite

export function applyOnly(db: SqliteDatabase, input: Migration[]) {
  return Effect.gen(function* () {
    yield* db.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    let completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    if (completed.size === 0) {
      if (
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        yield* db.run(sql`
          INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
          SELECT name, ${Date.now()}
          FROM ${sql.identifier("__drizzle_migrations")}
          WHERE name IS NOT NULL
        `)
        completed = new Set(
          (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }
    }

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          if (!process.env.OPENCODE_SKIP_MIGRATIONS) yield* migration.up(tx)
          yield* tx.run(
            sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          )
        }),
      )
    }
  })
}

export function applyPg(db: PgDatabase) {
  return Effect.gen(function* () {
    yield* db.run(
      sql`CREATE TABLE IF NOT EXISTS "migration" (id TEXT PRIMARY KEY, time_completed BIGINT NOT NULL)`,
    )
    const completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM "migration"`)).map((row: { id: string }) => row.id),
    )

    if (completed.size === 0) {
      yield* bootstrapPg(db)
      for (const migration of migrations) {
        yield* db.run(sql`INSERT INTO "migration" (id, time_completed) VALUES (${migration.id}, ${Date.now()})`)
      }
      return
    }

    for (const migration of migrations as Migration[]) {
      if (completed.has(migration.id)) continue
      if (!migration.pgUp) continue
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          if (!process.env.OPENCODE_SKIP_MIGRATIONS) yield* migration.pgUp!(tx)
          yield* (tx as unknown as PgDatabase).run(
            sql`INSERT INTO "migration" (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          )
        }),
      )
    }
  })
}
