/// <reference types="node" />
export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  up: (tx: Transaction) => Effect.Effect<void, unknown>
}

export function apply(db: Database) {
  return lock.withPermit(applyOnly(db, migrations))
}

export function applyOnly(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    yield* ensureMigrationTable(db)
    let completed = yield* loadCompleted(db)
    if (completed.size === 0) completed = yield* importLegacyDrizzleState(db)

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

function ensureMigrationTable(db: Database) {
  return db.run(
    sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
  )
}

function loadCompleted(db: Database) {
  return Effect.map(db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`), (rows) =>
    new Set(rows.map((row) => row.id)),
  )
}

function importLegacyDrizzleState(db: Database) {
  return Effect.gen(function* () {
    // Existing installs used Drizzle's migration journal. Seed the new
    // journal once so TypeScript migrations don't replay old SQL.
    if (!(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`))) {
      return yield* loadCompleted(db)
    }

    const columns = new Set(
      (yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`)).map((row) => row.name),
    )
    if (columns.has("name")) {
      yield* db.run(sql`
        INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
        SELECT name, ${Date.now()}
        FROM ${sql.identifier("__drizzle_migrations")}
        WHERE name IS NOT NULL
      `)
      return yield* loadCompleted(db)
    }

    const legacyCount =
      (yield* db.get<{ count: number }>(sql`SELECT count(*) as count FROM ${sql.identifier("__drizzle_migrations")}`))
        ?.count ?? 0
    for (const id of migrations.slice(0, legacyCount).map((migration) => migration.id)) {
      yield* db.run(
        sql`INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${id}, ${Date.now()})`,
      )
    }
    return yield* loadCompleted(db)
  })
}
