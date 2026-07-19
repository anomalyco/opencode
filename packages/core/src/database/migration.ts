export * as DatabaseMigration from "./migration"

import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
const lock = Semaphore.makeUnsafe(1)

export type Migration = {
  id: string
  up: (tx: Transaction) => Effect.Effect<void, unknown>
}

export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      const tables = yield* db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      if (tables.some((table) => table.name === "session")) return yield* applyOnly(db, migrations)
      if (tables.length > 0) return yield* Effect.die("Database is not empty and has no session table")
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* schema.up(tx)
          yield* tx.run(
            sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          yield* Effect.forEach(migrations, (migration) =>
            tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            ),
          )
        }),
      )
    }),
  )
}

// Drizzle-kit derives a migration's filename prefix from the same timestamp
// it stores as `created_at` in the journal, so the prefix can be recovered
// from journals that predate the `name` column.
function timestampPrefix(millis: number) {
  const date = new Date(millis)
  const pad = (value: number) => value.toString().padStart(2, "0")
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("")
}

export function applyOnly(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    yield* db.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    let completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    if (completed.size === 0) {
      // Existing installs used Drizzle's migration journal. Seed the new
      // journal once so TypeScript migrations don't replay old SQL.
      if (
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        const columns = yield* db.all<{ name: string }>(
          sql`SELECT name FROM pragma_table_info(${"__drizzle_migrations"})`,
        )
        if (columns.some((column) => column.name === "name")) {
          yield* db.run(sql`
            INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
            SELECT name, ${Date.now()}
            FROM ${sql.identifier("__drizzle_migrations")}
            WHERE name IS NOT NULL
          `)
        } else {
          // Journals written by drizzle-orm's stock migrator (before the
          // `name` column existed) only carry `created_at`. Map it back to
          // the migration id's timestamp prefix, mirroring the v0 -> v1
          // journal upgrade in effect-drizzle-sqlite, instead of crashing
          // with "no such column: name".
          const ids = new Map<string, string>()
          for (const migration of input) {
            const prefix = migration.id.split("_")[0]
            if (prefix) ids.set(prefix, migration.id)
          }
          const rows = yield* db.all<{ created_at: number | string }>(
            sql`SELECT created_at FROM ${sql.identifier("__drizzle_migrations")} WHERE created_at IS NOT NULL`,
          )
          const matched: string[] = []
          const unmatched: (number | string)[] = []
          for (const row of rows) {
            const stringified = String(row.created_at)
            const millis = Number(stringified.substring(0, stringified.length - 3) + "000")
            const id = Number.isFinite(millis) ? ids.get(timestampPrefix(millis)) : undefined
            if (id) matched.push(id)
            else unmatched.push(row.created_at)
          }
          if (unmatched.length > 0) {
            yield* Effect.die(
              `Found ${unmatched.length} drizzle journal entries (created_at: ${unmatched.join(", ")}) that do not match any known migration. The database was likely created by a different version of opencode.`,
            )
          } else {
            yield* Effect.forEach(matched, (id) =>
              db.run(
                sql`INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${id}, ${Date.now()})`,
              ),
            )
          }
        }
        completed = new Set(
          (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }
    }

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* migration.up(tx)
          yield* tx.run(
            sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
          )
        }),
      )
    }
  })
}
