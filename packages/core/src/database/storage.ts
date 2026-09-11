export * as DatabaseStorage from "./storage"

import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { sql } from "drizzle-orm"
import { Effect } from "effect"

export function configure(db: EffectDrizzleSqlite.EffectSQLiteDatabase) {
  return Effect.gen(function* () {
    const mode = yield* db.get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`)
    if (mode?.auto_vacuum !== 0) return
    if (yield* db.get(sql`SELECT 1 FROM sqlite_schema LIMIT 1`)) return
    // Existing databases require an offline VACUUM to change modes. Never
    // rebuild them on startup while other processes may be using them.
    yield* db.run("PRAGMA auto_vacuum = INCREMENTAL")
  })
}

export function reclaim(db: EffectDrizzleSqlite.EffectSQLiteDatabase) {
  return Effect.gen(function* () {
    const mode = yield* db.get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`)
    if (mode?.auto_vacuum !== 2) return
    const free = yield* db.get<{ freelist_count: number }>(sql`PRAGMA freelist_count`)
    if (!free?.freelist_count) return
    // Bound each pass rather than draining an arbitrarily large freelist.
    // Checkpointing still depends on readers releasing their WAL snapshots.
    yield* db.run("PRAGMA incremental_vacuum(256)")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
  }).pipe(Effect.catch((error) => Effect.logWarning("Failed to reclaim database pages", error)))
}
