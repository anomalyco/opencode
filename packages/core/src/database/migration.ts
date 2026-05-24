export * as DatabaseMigration from "./migration"

import { sql, type SQLWrapper } from "drizzle-orm"
import { Effect } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"

type EffectDatabase = EffectDrizzleSqlite.EffectSQLiteDatabase
type Query = string | SQLWrapper
type MigrationEffect<A> = Effect.Effect<A, unknown, never>
export type Transaction = {
  run: (query: Query) => MigrationEffect<unknown>
}
type SyncDatabase = {
  run: (query: Query) => unknown
  all: <A = unknown>(query: Query) => A[]
  get: <A = unknown>(query: Query) => A | undefined
}
type SyncTransaction = {
  run: (query: Query) => unknown
}
type Database = EffectDatabase | SyncDatabase
type Target = {
  run: (query: Query) => MigrationEffect<unknown>
  all: <A = unknown>(query: Query) => MigrationEffect<A[]>
  get: <A = unknown>(query: Query) => MigrationEffect<A | undefined>
  transaction: <A>(body: (tx: Transaction) => MigrationEffect<A>) => MigrationEffect<A>
}

export type Migration = {
  id: string
  up: (tx: Transaction) => MigrationEffect<void>
}

export function apply(db: EffectDatabase): MigrationEffect<void>
export function apply(db: SyncDatabase): MigrationEffect<void>
export function apply(db: Database) {
  return applyOnlyImpl(db, migrations)
}

export function applyOnly(db: EffectDatabase, input: Migration[]): MigrationEffect<void>
export function applyOnly(db: SyncDatabase, input: Migration[]): MigrationEffect<void>
export function applyOnly(db: Database, input: Migration[]) {
  return applyOnlyImpl(db, input)
}

function applyOnlyImpl(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    const target = normalize(db)

    yield* target.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    let completed = new Set(
      (yield* target.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    if (completed.size === 0) {
      // Existing installs used Drizzle's migration journal. Seed the new
      // journal once so TypeScript migrations don't replay old SQL.
      if (
        yield* target.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        yield* target.run(sql`
          INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
          SELECT name, ${Date.now()}
          FROM ${sql.identifier("__drizzle_migrations")}
          WHERE name IS NOT NULL
        `)
        completed = new Set(
          (yield* target.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }
    }

    for (const migration of input) {
      if (completed.has(migration.id)) continue
      yield* target.transaction((tx) =>
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

function normalize(db: Database): Target {
  if (isEffectDatabase(db)) return normalizeEffect(db)
  return normalizeSync(db)
}

function normalizeEffect(db: EffectDatabase): Target {
  return {
    run: (query) => db.run(query).pipe(Effect.as(undefined)),
    all: (query) => db.all(query),
    get: (query) => db.get(query),
    transaction: (body) => db.transaction((tx) => body(normalizeEffectTransaction(tx))),
  }
}

function normalizeSync(db: SyncDatabase): Target {
  const tx = normalizeSyncTransaction(db)
  return {
    run: tx.run,
    all: (query) => Effect.try({ try: () => db.all(query), catch: (err) => err }),
    get: (query) => Effect.try({ try: () => db.get(query), catch: (err) => err }),
    transaction: (body) =>
      Effect.gen(function* () {
        yield* tx.run("BEGIN")
        const result = yield* body(tx).pipe(Effect.catch((err) => tx.run("ROLLBACK").pipe(Effect.flatMap(() => Effect.fail(err)))))
        yield* tx.run("COMMIT")
        return result
      }),
  }
}

function normalizeEffectTransaction(tx: { run: (query: Query) => MigrationEffect<unknown> }): Transaction {
  return {
    run: (query) => tx.run(query),
  }
}

function normalizeSyncTransaction(tx: SyncTransaction): Transaction {
  return {
    run: (query) => Effect.try({ try: () => tx.run(query), catch: (err) => err }),
  }
}

function isEffectDatabase(db: Database): db is EffectDatabase {
  return "raw" in db
}
