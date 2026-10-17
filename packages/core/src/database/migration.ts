export * as DatabaseMigration from "./migration.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { supportsForeignKeyToggle } from "#sqlite"
import type { EffectDrizzleSqlite } from "./drizzle.js"
import { prefixedIdentifier } from "./drizzle.js"
import { migrations } from "./migration.gen.js"
import schema from "./schema.gen.js"
import { Global } from "@opencode/util/global"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

const journal = prefixedIdentifier("migration")

export type Migration = {
  id: string
  foreignKeys?: boolean
  /**
   * `tx` renders table declarations and `prefixedIdentifier` names under the
   * database's table prefix. Raw SQL must name tables and indexes through
   * them rather than as literal text; generated migrations already do.
   */
  up: (tx: Transaction) => Effect.Effect<void, unknown, Global.Service>
}

// Not serialized here: the Database layer holds a lock scoped to the database
// it is bootstrapping, since two instances over one file must not race.
export function apply(db: Database, prefix = "") {
  return Effect.gen(function* () {
    // OpenCode owns the table namespace under its prefix, which is every
    // unprefixed name by default. Embedders sharing this database may own
    // underscore-prefixed tables there, or any table outside the prefix, which
    // bootstrap ignores.
    const tables = yield* db.all<{ name: string }>(
      sql`SELECT substr(name, ${prefix.length + 1}) AS name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND substr(name, 1, ${prefix.length}) = ${prefix} AND substr(name, ${prefix.length + 1}, 1) <> '_'`,
    )
    if (tables.some((table) => table.name === "session" || table.name === "session_v2"))
      return yield* applyOnly(db, migrations, prefix)
    if (tables.length > 0) return yield* Effect.die(new Error("Database is not empty and has no session table"))
    const started = Date.now()
    yield* Effect.logInfo("database schema bootstrap started", { migrations: migrations.length })
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* schema.up(tx)
        yield* tx.run(sql`CREATE TABLE ${journal} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
        yield* Effect.forEach(migrations, (migration) =>
          tx.run(sql`INSERT INTO ${journal} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`),
        )
      }),
    )
    yield* Effect.logInfo("database schema bootstrap completed", {
      migrations: migrations.length,
      durationMs: Date.now() - started,
    })
  })
}

export function applyOnly(db: Database, input: Migration[], prefix = "") {
  return Effect.gen(function* () {
    yield* db.run(sql`CREATE TABLE IF NOT EXISTS ${journal} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
    let completed = new Set((yield* db.all<{ id: string }>(sql`SELECT id FROM ${journal}`)).map((row) => row.id))
    if (completed.size === 0 && prefix === "") {
      // Existing installs used Drizzle's migration journal. Seed the new
      // journal once so TypeScript migrations don't replay old SQL. Prefixed
      // databases postdate it.
      if (
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        const named = (yield* db.all<{ name: string }>(
          sql`SELECT name FROM pragma_table_info('__drizzle_migrations')`,
        )).some((column) => column.name === "name")

        if (named) {
          yield* db.run(sql`
            INSERT OR IGNORE INTO ${journal} (id, time_completed)
            SELECT name, ${Date.now()}
            FROM ${sql.identifier("__drizzle_migrations")}
            WHERE name IS NOT NULL
          `)
        }

        if (!named) {
          const entries = yield* db.all<{ created_at: number; prefix: string | null }>(sql`
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
            yield* db.run(sql`
              INSERT OR IGNORE INTO ${journal} (id, time_completed)
              VALUES (${migration.id}, ${Date.now()})
            `)
          }
        }
        completed = new Set((yield* db.all<{ id: string }>(sql`SELECT id FROM ${journal}`)).map((row) => row.id))
      }
    }

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      const started = Date.now()
      yield* Effect.logInfo("database migration started", { migration: migration.id })
      const apply = db.transaction((tx) =>
        Effect.gen(function* () {
          yield* migration.up(tx)
          yield* tx.run(sql`INSERT INTO ${journal} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`)
        }),
      )
      const run =
        migration.foreignKeys !== false
          ? apply
          : Effect.gen(function* () {
              // Durable Object SQLite rejects the foreign_keys toggle; the closest
              // allowlisted relaxation is deferring enforcement to transaction commit.
              const relaxForeignKeys = supportsForeignKeyToggle
                ? db.run(sql`PRAGMA foreign_keys = OFF`)
                : db.run(sql`PRAGMA defer_foreign_keys = ON`)
              const restoreForeignKeys = supportsForeignKeyToggle ? db.run(sql`PRAGMA foreign_keys = ON`) : Effect.void
              yield* relaxForeignKeys
              yield* apply.pipe(Effect.ensuring(restoreForeignKeys.pipe(Effect.orDie)))
            })
      yield* run.pipe(
        Effect.tapError((error) =>
          Effect.logError("database migration failed", {
            migration: migration.id,
            durationMs: Date.now() - started,
            error,
          }),
        ),
      )
      yield* Effect.logInfo("database migration completed", {
        migration: migration.id,
        durationMs: Date.now() - started,
      })
    }
  })
}
