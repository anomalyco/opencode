import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import {
  DATABASE_OWNER_TABLE,
  DatabaseOwnedError,
  databaseOwnerAlive,
  databaseOwnerIdentity,
  ownsDatabase,
  parseDatabaseOwnerJson,
} from "@opencode/util/database-owner"
import type { EffectDrizzleSqlite } from "./drizzle.js"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
const table = sql.identifier(DATABASE_OWNER_TABLE)

/** The private underscore table is ignored by schema bootstrap, so even a fresh DB can be fenced first. */
export const acquireDatabaseOwner = Effect.fnUntraced(function* (db: Database) {
  yield* db.transaction(
    (tx) =>
      Effect.gen(function* () {
        yield* tx.run(
          sql`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)`,
        )
        const row = yield* tx.get<{ value: string }>(sql`SELECT value FROM ${table} WHERE id = 1`)
        const previous = row ? yield* Effect.try(() => parseDatabaseOwnerJson(row.value)) : undefined
        if (previous && !ownsDatabase(previous) && databaseOwnerAlive(previous))
          return yield* Effect.fail(new DatabaseOwnedError(previous))
        const value = JSON.stringify({
          version: 1,
          ...databaseOwnerIdentity,
          refs: previous && ownsDatabase(previous) ? previous.refs + 1 : 1,
        })
        yield* tx.run(
          sql`INSERT INTO ${table} (id, value) VALUES (1, ${value}) ON CONFLICT (id) DO UPDATE SET value = excluded.value`,
        )
      }),
    { behavior: "immediate" },
  )
  return true
})

export const releaseDatabaseOwner = Effect.fnUntraced(function* (db: Database, acquired: boolean) {
  if (!acquired) return
  yield* db.transaction(
    (tx) =>
      Effect.gen(function* () {
        const row = yield* tx.get<{ value: string }>(sql`SELECT value FROM ${table} WHERE id = 1`)
        if (!row) return
        const parsed = yield* Effect.try(() => parseDatabaseOwnerJson(row.value)).pipe(Effect.option)
        if (Option.isNone(parsed)) {
          yield* Effect.logWarning("Cannot release corrupt database execution ownership; leaving it untouched")
          return
        }
        const previous = parsed.value
        if (!ownsDatabase(previous)) return
        if (previous.refs === 1) {
          yield* tx.run(sql`DELETE FROM ${table} WHERE id = 1`)
          return
        }
        const value = JSON.stringify({ ...previous, refs: previous.refs - 1 })
        yield* tx.run(sql`UPDATE ${table} SET value = ${value} WHERE id = 1`)
      }),
    { behavior: "immediate" },
  )
})
