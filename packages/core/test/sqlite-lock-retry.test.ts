import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { isSqlError } from "effect/sql/SqlError"
import { Sqlite } from "@opencode/core/database/sqlite"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"

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
// stale and the upgrade fails with SQLITE_BUSY_SNAPSHOT. The retry wrapper,
// applied indiscriminately, would loop this error for the full 30 s budget;
// only a rollback + restart of the whole transaction helps. Inside an
// explicit transaction, statements must fail fast.
test("fails fast on BUSY_SNAPSHOT inside a deferred transaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sqlite-snapshot-"))
  const filename = join(dir, "snap.db")

  try {
    // Set up schema and one row, enable WAL, all via the layer.
    await Effect.runPromise(
      Effect.gen(function* () {
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

// Regression: the node driver errors with { code: "ERR_SQLITE_ERROR",
// errcode: 5, errstr: "database is locked" } — no errno, no SQLITE_* string
// code — so effect's classifier files the busy error as UnknownError and the
// retry wrapper never fires. node:sqlite's DatabaseSync is typed here instead
// of bun:sqlite's Database; everything else matches the bun test above.
test("node driver retries statements while another process holds the write lock", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const { sqliteLayer: nodeSqliteLayer } = await import("@opencode/core/database/sqlite.node")
  const dir = await mkdtemp(join(tmpdir(), "sqlite-node-retry-"))
  const filename = join(dir, "locked.db")

  try {
    const holder = new DatabaseSync(filename)
    holder.exec("create table t (id integer primary key, v text)")
    holder.exec("insert into t values (1, 'before')")
    holder.exec("pragma journal_mode = WAL")
    holder.exec("begin immediate")
    setTimeout(() => {
      holder.exec("commit")
      holder.close()
    }, 100)

    const rows = (await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        const native = (yield* Sqlite.Native) as DatabaseSync
        native.exec("PRAGMA busy_timeout = 0")
        yield* db.run(sql`update t set v = 'after' where id = 1`)
        return yield* db.all(sql`select v from t where id = 1`)
      }).pipe(Effect.provide(nodeSqliteLayer({ filename })), Effect.scoped) as Effect.Effect<
        Array<Record<string, unknown>>,
        unknown,
        never
      >,
    )) as Array<Record<string, unknown>>
    expect(rows[0].v).toBe("after")
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

// Regression: the node in-transaction BUSY_SNAPSHOT path must fail fast, the
// same contract the bun driver test pins under the bun layer.
test("node in-transaction lock surfaces fast instead of retrying", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const { sqliteLayer: nodeSqliteLayer } = await import("@opencode/core/database/sqlite.node")
  const dir = await mkdtemp(join(tmpdir(), "sqlite-node-snapshot-"))
  const filename = join(dir, "snap.db")

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const native = (yield* Sqlite.Native) as DatabaseSync
        native.exec("create table t (id integer primary key, v text)")
        native.exec("insert into t values (1, 'before')")
        native.exec("PRAGMA journal_mode = WAL")
        native.exec("PRAGMA busy_timeout = 0")
      }).pipe(Effect.provide(nodeSqliteLayer({ filename })), Effect.scoped),
    )

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
                yield* Effect.sync(() => {
                  const other = new DatabaseSync(filename)
                  other.exec("update t set v = 'after' where id = 1")
                  other.close()
                })
                yield* tx.run(sql`update t set v = 'after2' where id = 1`)
              }),
            { behavior: "deferred" },
          )
        }).pipe(Effect.provide(nodeSqliteLayer({ filename })), Effect.scoped),
      )
    } catch (e) {
      error = e
    }
    const elapsed = Date.now() - start
    expect(error).toBeDefined()
    expect(elapsed).toBeLessThan(2000)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

// Regression: a non-lock failure (unique-constraint violation) must surface
// immediately, not ride the lock-retry schedule. Widening retryLocked's
// predicate beyond LockTimeoutError would retry this constraint error, and the
// only visible symptom would be slowness.
test("fails fast on a non-lock SqlError", async () => {
  const { Database } = await import("bun:sqlite")
  const dir = await mkdtemp(join(tmpdir(), "sqlite-constraint-"))
  const filename = join(dir, "constraint.db")

  try {
    const holder = new Database(filename, { create: true })
    holder.run("create table t (id integer primary key, v text)")
    holder.run("insert into t values (1, 'before')")
    holder.close()

    // Widening retryLocked's predicate beyond LockTimeoutError would retry
    // this constraint violation for the whole retry budget, so the elapsed
    // assertion is the predicate guard; the reason-class assertion pins that
    // the driver classified the failure rather than leaving it unknown.
    const start = Date.now()
    let error: unknown
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const db = yield* EffectDrizzleSqlite.makeWithDefaults()
          yield* db.run(sql`insert into t values (1, 'dup')`)
        }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
      )
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(Date.now() - start).toBeLessThan(1000)
    const reasons = (
      error as {
        cause?: { reasons?: ReadonlyArray<{ error?: { reason?: { _tag?: string } } }> }
      },
    ).cause?.reasons ?? []
    expect(reasons[0]?.error?.reason?._tag).not.toBe("LockTimeoutError")
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(()=>{})
  }
})

// Regression: the retry pipe must also cover the runValues path (executeValues
// and executeValuesUnprepared route there). Every other test goes through
// db.run/db.all, so dropping .pipe(retryIfAutocommit) from either runValues
// block would leave the suite green while values-path writes stop retrying.
test("runValues path retries statements while another process holds the write lock", async () => {
  const { Database } = await import("bun:sqlite")
  const dir = await mkdtemp(join(tmpdir(), "sqlite-retry-values-"))
  const filename = join(dir, "locked.db")

  try {
    const holder = new Database(filename, { create: true })
    holder.run("create table t (id integer primary key, v text)")
    holder.run("insert into t values (1, 'before')")
    holder.run("pragma journal_mode = WAL")
    holder.run("begin immediate")
    setTimeout(() => holder.run("commit"), 100)

    const rows = (await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        const native = (yield* Sqlite.Native) as Database
        native.run("PRAGMA busy_timeout = 0")
        // .values() routes to executeValues, i.e. the runValues wiring.
        yield* db.values(sql`update t set v = 'after' where id = 1`)
        return yield* db.values(sql`select v from t where id = 1`)
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped) as Effect.Effect<
        ReadonlyArray<ReadonlyArray<unknown>>,
        unknown,
        never
      >,
    )) as ReadonlyArray<ReadonlyArray<unknown>>
    expect(rows[0][0]).toBe("after")
    holder.close()
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
