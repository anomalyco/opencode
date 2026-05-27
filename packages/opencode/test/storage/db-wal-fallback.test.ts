import { describe, expect, mock, afterEach } from "bun:test"
import { Effect } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { it } from "../lib/effect"

// Track which pragmas were issued and toggle WAL failure per test.
const runCalls: string[] = []
let walShouldFail = true

// Wrap the real bun-sqlite init so migrations still work, but intercept
// PRAGMA journal_mode = WAL to simulate environments where WAL is unavailable.
void mock.module("#db", () => {
  // Lazy-require so the mock factory does not eagerly load bun:sqlite at import time.
  const { Database } = require("bun:sqlite")
  const { drizzle } = require("drizzle-orm/bun-sqlite")
  return {
    init: (dbPath: string) => {
      const sqlite = new Database(dbPath, { create: true })
      const db = drizzle({ client: sqlite })
      const realRun = db.run.bind(db)
      db.run = (sql: string) => {
        runCalls.push(sql)
        if (walShouldFail && sql === "PRAGMA journal_mode = WAL") {
          throw new Error("simulated WAL pragma failure")
        }
        return realRun(sql)
      }
      return db
    },
  }
})

afterEach(async () => {
  const { Database } = await import("@/storage/db")
  Database.close()
  Database.Client.reset()
  runCalls.length = 0
  walShouldFail = true
})

describe("Database WAL fallback", () => {
  it.effect("falls back to journal_mode = DELETE when WAL pragma fails", () =>
    Effect.gen(function* () {
      const { Database } = yield* Effect.promise(() => import("@/storage/db"))
      Database.Client.reset()
      runCalls.length = 0

      const db = Database.Client({ disableChannelDb: true, skipMigrations: true })

      expect(db).toBeDefined()
      expect(Database.Client.loaded()).toBe(true)
      expect(runCalls).toContain("PRAGMA journal_mode = WAL")
      expect(runCalls).toContain("PRAGMA journal_mode = DELETE")
      // DELETE must come after the failed WAL attempt.
      expect(runCalls.indexOf("PRAGMA journal_mode = DELETE")).toBeGreaterThan(
        runCalls.indexOf("PRAGMA journal_mode = WAL"),
      )
    }).pipe(Effect.provide(RuntimeFlags.layer({ disableChannelDb: true, skipMigrations: true }))),
  )

  it.effect("uses WAL when the pragma succeeds and skips the DELETE fallback", () =>
    Effect.gen(function* () {
      walShouldFail = false
      const { Database } = yield* Effect.promise(() => import("@/storage/db"))
      Database.Client.reset()
      runCalls.length = 0

      const db = Database.Client({ disableChannelDb: true, skipMigrations: true })

      expect(db).toBeDefined()
      expect(runCalls).toContain("PRAGMA journal_mode = WAL")
      expect(runCalls).not.toContain("PRAGMA journal_mode = DELETE")
    }).pipe(Effect.provide(RuntimeFlags.layer({ disableChannelDb: true, skipMigrations: true }))),
  )
})
