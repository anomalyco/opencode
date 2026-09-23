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

// Regression: a DEFERRED WAL transaction that holds a read snapshot cannot be
// upgraded to a write after another connection commits — the snapshot is
// stale and the upgrade fails with SQLITE_BUSY_SNAPSHOT. #47567's retry
// wrapper, applied indiscriminately, would loop this error for the full
// 30 s budget; only a rollback + restart of the whole transaction helps.
// Inside an explicit transaction, statements must fail fast.
test("fails fast on BUSY_SNAPSHOT inside a deferred transaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sqlite-snapshot-"))
  const filename = join(dir, "snap.db")

  try {
    // Set up schema and one row, enable WAL, all via the layer.
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        const native = (yield* Sqlite.Native) as Database
        native.run("create table t (id integer primary key, v text)")
        native.run("insert into t values (1, 'before')")
        native.run("PRAGMA journal_mode = WAL")
        native.run("PRAGMA busy_timeout = 0")
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
    )

    // Inside a deferred transaction: read, then have another connection write
    // and commit (invalidating the read snapshot), then attempt a write.
    // The write must surface a LockTimeoutError immediately, not loop the
    // 30 s retry budget.
    const start = Date.now()
    let error: unknown
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const db = yield* EffectDrizzleSqlite.makeWithDefaults()
          yield* db.transaction(
            (tx) =>
              Effect.gen(function* () {
                yield* tx.get(sql`select v from t where id = 1`)
                // A separate connection writes and commits while we hold the
                // deferred transaction's read snapshot.
                yield* Effect.sync(() => {
                  const other = new Database(filename)
                  other.run("update t set v = 'after' where id = 1")
                  other.close()
                })
                // This write must fail with BUSY_SNAPSHOT and surface fast —
                // the retry helper must NOT keep trying the same stale snapshot.
                yield* tx.run(sql`update t set v = 'after2' where id = 1`)
              }),
            { behavior: "deferred" },
          )
        }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
      )
    } catch (e) {
      error = e
    }
    const elapsed = Date.now() - start

    expect(error).toBeDefined()
    // drizzle wraps the raw SqlError inside EffectDrizzleQueryError.cause.
    // Effect wraps the SqlError in a Cause. Walk the failure chain to confirm
    // the surface error is a LockTimeoutError wrapping SQLITE_BUSY_SNAPSHOT.
    const reasons =
      (
        error as {
          cause?: { reasons?: ReadonlyArray<{ error?: { reason?: { _tag?: string; cause?: { code?: string } } } }> }
        }
      ).cause?.reasons ?? []
    const inner = reasons[0]?.error
    expect(inner?.reason?._tag).toBe("LockTimeoutError")
    expect((inner?.reason?.cause as { code?: string } | undefined)?.code).toBe("SQLITE_BUSY_SNAPSHOT")
    expect(elapsed).toBeLessThan(2000)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
