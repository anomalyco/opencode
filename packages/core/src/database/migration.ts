export * as DatabaseMigration from "./migration.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql"
import { supportsForeignKeyToggle } from "#sqlite"
import { EffectDrizzleSqlite } from "./drizzle.js"
import { migrations } from "./migration.gen.js"
import legacyCredentials from "./migration/20260805200742_import_legacy_credentials.js"
import schema from "./schema.gen.js"
import { Global } from "@opencode/util/global"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase & { readonly $client?: SqlClient.SqlClient }
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
type Queryable = Pick<Database, "all" | "get" | "run">

export type Migration = {
  id: string
  foreignKeys?: boolean
  up: (tx: Transaction) => Effect.Effect<void, unknown, Global.Service>
}

// In-process callers serialize through the Database layer's per-path semaphore;
// cross-process races serialize on SQLite write transactions and recheck state
// after acquiring the lock.
export function apply(db: Database, options = { legacyCredentials: true }) {
  return Effect.gen(function* () {
    const tables = yield* listAppTables(db)
    if (hasSessionTable(tables)) return yield* applyOnly(db, migrations)

    const started = yield* db.transaction(
      (tx) =>
        Effect.gen(function* () {
          const current = yield* listAppTables(tx)
          if (hasSessionTable(current)) return undefined
          if (current.length > 0) return yield* Effect.die(new Error("Database is not empty and has no session table"))
          const started = Date.now()
          yield* Effect.logInfo("database schema bootstrap started", { migrations: migrations.length })
          yield* schema.up(tx)
          if (options.legacyCredentials) yield* legacyCredentials.up(tx)
          yield* tx.run(
            sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          yield* Effect.forEach(migrations, (migration) =>
            tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            ),
          )
          return started
        }),
      { behavior: "immediate" },
    )

    if (started === undefined) return yield* applyOnly(db, migrations)
    yield* Effect.logInfo("database schema bootstrap completed", {
      migrations: migrations.length,
      durationMs: Date.now() - started,
    })
  })
}

export function applyOnly(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    const completed = yield* loadCompleted(db, input)

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      const attempted = Date.now()
      const apply = db.transaction(
        (tx) =>
          Effect.gen(function* () {
            if (yield* tx.get(sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${migration.id}`)) {
              return undefined
            }
            const started = Date.now()
            yield* Effect.logInfo("database migration started", { migration: migration.id })
            yield* migration.up(tx)
            yield* tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            )
            return started
          }),
        { behavior: "immediate" },
      )
      const run =
        migration.foreignKeys !== false
          ? apply
          : Effect.gen(function* () {
              // Durable Object SQLite rejects the foreign_keys toggle; the closest
              // allowlisted relaxation is deferring enforcement to transaction commit.
              const toggleForeignKeys =
                supportsForeignKeyToggle &&
                !(db.$client !== undefined && EffectDrizzleSqlite.managesTransactionsNatively(db.$client))
              const relaxForeignKeys = toggleForeignKeys
                ? db.run(sql`PRAGMA foreign_keys = OFF`)
                : db.run(sql`PRAGMA defer_foreign_keys = ON`)
              const restoreForeignKeys = toggleForeignKeys
                ? Effect.asVoid(db.run(sql`PRAGMA foreign_keys = ON`))
                : Effect.void
              yield* relaxForeignKeys
              return yield* apply.pipe(Effect.ensuring(restoreForeignKeys.pipe(Effect.orDie)))
            })
      const started = yield* run.pipe(
        Effect.tapError((error) =>
          Effect.logError("database migration failed", {
            migration: migration.id,
            durationMs: Date.now() - attempted,
            error,
          }),
        ),
      )
      completed.add(migration.id)
      if (started === undefined) continue
      yield* Effect.logInfo("database migration completed", {
        migration: migration.id,
        durationMs: Date.now() - started,
      })
    }
  })
}

// OpenCode owns the unprefixed table namespace. Embedders sharing this
// database may own underscore-prefixed tables, which bootstrap ignores.
function listAppTables(db: Queryable) {
  return db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, 1) <> '_'`,
  )
}

function hasSessionTable(tables: ReadonlyArray<{ name: string }>) {
  return tables.some((table) => table.name === "session" || table.name === "session_v2")
}

function readCompleted(db: Queryable) {
  return Effect.map(
    db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`),
    (rows) => new Set(rows.map((row) => row.id)),
  )
}

function loadCompleted(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    const tables = yield* db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('migration', '__drizzle_migrations')`,
    )
    const hasMigration = tables.some((table) => table.name === "migration")
    const hasLegacy = tables.some((table) => table.name === "__drizzle_migrations")
    const existing = hasMigration ? yield* readCompleted(db) : new Set<string>()
    if (hasMigration && (existing.size > 0 || !hasLegacy)) return existing

    return yield* db.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* tx.run(
            sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
          )
          const completed = yield* readCompleted(tx)
          if (completed.size > 0) return completed
          // Existing installs used Drizzle's migration journal. Seed the new
          // journal once so TypeScript migrations don't replay old SQL.
          if (
            !(yield* tx.get(
              sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`,
            ))
          ) {
            return completed
          }
          const named = (yield* tx.all<{ name: string }>(
            sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`,
          )).some((column) => column.name === "name")

          if (named) {
            yield* tx.run(sql`
              INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
              SELECT name, ${Date.now()}
              FROM ${sql.identifier("__drizzle_migrations")}
              WHERE name IS NOT NULL
            `)
            return yield* readCompleted(tx)
          }

          const entries = yield* tx.all<{ created_at: number; prefix: string | null }>(sql`
            SELECT created_at, strftime('%Y%m%d%H%M%S', created_at / 1000, 'unixepoch') AS prefix
            FROM ${sql.identifier("__drizzle_migrations")}
            WHERE created_at IS NOT NULL
          `)

          for (const entry of entries) {
            const migration = input.find((item) => item.id.startsWith(`${entry.prefix}_`))
            if (!migration) {
              return yield* Effect.die(
                new Error(`Legacy migration timestamp ${entry.created_at} does not match any known migration`),
              )
            }
            yield* tx.run(sql`
              INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
              VALUES (${migration.id}, ${Date.now()})
            `)
          }
          return yield* readCompleted(tx)
        }),
      { behavior: "immediate" },
    )
  })
}
