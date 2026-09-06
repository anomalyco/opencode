import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { Sqlite } from "@opencode-ai/core/database/sqlite"
import { layer as sqliteLayer } from "@opencode-ai/core/database/sqlite.bun"

// Regression: a statement blocked by another process's write lock (SQLITE_BUSY)
// must retry until the lock frees, not fail the prompt with LockTimeoutError.
test("retries statements while another process holds the write lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sqlite-retry-"))
  const filename = join(dir, "locked.db")

  try {
    const holder = new Database(filename, { create: true })
    holder.run("create table t (id integer primary key, v text)")
    holder.run("insert into t values (1, 'before')")
    holder.run("pragma journal_mode = WAL")
    holder.run("begin immediate")

    // Release the lock 100ms in; the retry loop must recover.
    setTimeout(() => holder.run("commit"), 100)

    const rows = (await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        const native = (yield* Sqlite.Native) as Database
        native.run("PRAGMA busy_timeout = 0")
        yield* db.run(sql`update t set v = 'after' where id = 1`)
        return yield* db.all(sql`select v from t where id = 1`)
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped) as Effect.Effect<
        Array<Record<string, unknown>>,
        unknown,
        never
      >,
    )) as Array<Record<string, unknown>>
    expect(rows[0].v).toBe("after")
    holder.close()
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
