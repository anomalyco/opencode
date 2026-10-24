export * as DatabaseStorage from "./storage.js"

import { sql } from "drizzle-orm"
import { Effect } from "effect"
import type { EffectDrizzleSqlite } from "./drizzle.js"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase

// 256 pages is 1 MiB with the default page size. Keep each pass small so
// startup and aggregate deletion never turn into a database-wide rewrite.
const RECLAIM_PAGES = 256

export function configure(db: Database) {
  return Effect.gen(function* () {
    const mode = yield* db.get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`)
    if (mode?.auto_vacuum !== 0) return
    // Changing an existing database needs VACUUM, which cannot run while other
    // processes share the file. Only configure files created by this layer.
    if (yield* db.get(sql`SELECT 1 FROM sqlite_master LIMIT 1`)) return
    yield* db.run("PRAGMA auto_vacuum = INCREMENTAL")
  }).pipe(Effect.catch((error) => Effect.logWarning("failed to configure database auto-vacuum", { error })))
}

export function reclaim(db: Database) {
  return Effect.gen(function* () {
    const mode = yield* db.get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`)
    if (mode?.auto_vacuum !== 2) return
    const free = yield* db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
    if (!free?.freelist_count) return
    // Must run outside a transaction: wal_checkpoint fails while one is open.
    yield* db.run(`PRAGMA incremental_vacuum(${RECLAIM_PAGES})`)
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
  }).pipe(Effect.catch((error) => Effect.logWarning("failed to reclaim database pages", { error })))
}
