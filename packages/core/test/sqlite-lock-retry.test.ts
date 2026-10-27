import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { Deferred, Effect, Fiber } from "effect"
import { sql } from "drizzle-orm"
import { Sqlite } from "@opencode/core/database/sqlite"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"

// Lock-retry contract of the sqlite client. Foreign write locks are held by a
// second connection and released by the test, never by a timer, and fiber
// order is set with Deferreds. Where a sleep remains it is a wide margin
// ("long enough that everything before it has certainly happened"), not a
// tuned window: effect sleeps never fire early, so a first attempt always
// precedes a release scheduled a second later.

const withDatabase = (prefix: string, run: (filename: string) => Promise<void>) =>
  mkdtemp(join(tmpdir(), prefix)).then(async (dir) => {
    try {
      await run(join(dir, "test.db"))
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

// Schema plus WAL (a database-level setting) through one throwaway client.
// busy_timeout is per connection, so each test sets it on its own.
const initFile = (filename: string, exec: (native: unknown, text: string) => void, layer = sqliteLayer({ filename })) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const native = yield* Sqlite.Native
      for (const text of [
        "create table t (id integer primary key, v text)",
        "insert into t values (1, 'before')",
        "pragma journal_mode = WAL",
      ]) {
        exec(native, text)
      }
    }).pipe(Effect.provide(layer), Effect.scoped),
  )

const readValue = (filename: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      const rows = (yield* db.all(sql`select v from t where id = 1`)) as Array<{ v: string }>
      return rows[0]?.v
    }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
  )

// Fork `write` against a held lock, hold the lock well past its first
// (immediately failing, busy_timeout = 0) attempt so the retry loop is
// entered for sure, then release from the test and let a later attempt land.
const releaseAfterRetries = <A, E>(write: Effect.Effect<A, E>, release: () => void) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(write)
    yield* Effect.sleep("1 second")
    release()
    yield* Fiber.join(fiber)
  })

// drizzle wraps the raw SqlError inside EffectDrizzleQueryError.cause.reasons[0].error.
const surfaceReason = (error: unknown) =>
  (
    (error as { cause?: { reasons?: ReadonlyArray<{ error?: { reason?: unknown } }> } })?.cause?.reasons ?? []
  )[0]?.error?.reason as { _tag?: string; cause?: { code?: string } } | undefined

// Regression: a statement blocked by another connection's write lock
// (SQLITE_BUSY past busy_timeout) must retry until the lock frees, not fail
// the prompt with LockTimeoutError.
test("retries a statement until another connection releases the write lock", async () => {
  await withDatabase("sqlite-retry-", async (filename) => {
    await initFile(filename, (native, text) => (native as Database).run(text))
    const lock = new Database(filename)
    lock.run("begin immediate")

    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        ;((yield* Sqlite.Native) as Database).run("pragma busy_timeout = 0")
        yield* releaseAfterRetries(db.run(sql`update t set v = 'after' where id = 1`), () => {
          lock.run("commit")
          lock.close()
        })
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
    )
    expect(await readValue(filename)).toBe("after")
  })
})

// Regression: executeValues routes through runValues, a separate wire in the
// driver; dropping the retry there would leave this green-broken.
test("retries on the values path too", async () => {
  await withDatabase("sqlite-retry-values-", async (filename) => {
    await initFile(filename, (native, text) => (native as Database).run(text))
    const lock = new Database(filename)
    lock.run("begin immediate")

    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        ;((yield* Sqlite.Native) as Database).run("pragma busy_timeout = 0")
        yield* releaseAfterRetries(db.values(sql`update t set v = 'after' where id = 1`), () => {
          lock.run("commit")
          lock.close()
        })
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
    )
    expect(await readValue(filename)).toBe("after")
  })
})

// Regression: node:sqlite reports busy as { code: "ERR_SQLITE_ERROR", errcode:
// 5 } — no errno and no SQLITE_* string code, which is all effect's
// classifier reads — so lock timeouts filed as UnknownError and the retry
// never fired on that driver.
test("node driver classifies busy as a lock timeout and retries", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const { sqliteLayer: nodeSqliteLayer } = await import("@opencode/core/database/sqlite.node")
  type NodeDatabase = InstanceType<typeof DatabaseSync>

  await withDatabase("sqlite-node-retry-", async (filename) => {
    await initFile(filename, (native, text) => (native as NodeDatabase).exec(text), nodeSqliteLayer({ filename }))
    const lock = new DatabaseSync(filename)
    lock.exec("begin immediate")

    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        ;((yield* Sqlite.Native) as NodeDatabase).exec("pragma busy_timeout = 0")
        yield* releaseAfterRetries(db.run(sql`update t set v = 'after' where id = 1`), () => {
          lock.exec("commit")
          lock.close()
        })
      }).pipe(Effect.provide(nodeSqliteLayer({ filename })), Effect.scoped),
    )
    expect(await readValue(filename)).toBe("after")
  })
})

// Regression: a DEFERRED WAL transaction that has read cannot upgrade to a
// write after another connection commits — the snapshot is stale and the
// upgrade fails with SQLITE_BUSY_SNAPSHOT. Retrying the statement cannot fix
// a stale snapshot; it must surface at once so the caller can roll back and
// rerun the whole transaction. The foreign write is synchronous between the
// read and the write, so this test has no timing at all.
test("fails fast inside a deferred transaction on a stale snapshot", async () => {
  await withDatabase("sqlite-snapshot-", async (filename) => {
    await initFile(filename, (native, text) => (native as Database).run(text))

    const start = Date.now()
    let error: unknown
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* db.transaction(
          (tx) =>
            Effect.gen(function* () {
              yield* tx.get(sql`select v from t where id = 1`)
              yield* Effect.sync(() => {
                const other = new Database(filename)
                other.run("update t set v = 'gone' where id = 1")
                other.close()
              })
              yield* tx.run(sql`update t set v = 'after' where id = 1`)
            }),
          { behavior: "deferred" },
        )
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
    ).catch((e) => {
      error = e
    })

    expect(error).toBeDefined()
    expect(surfaceReason(error)?._tag).toBe("LockTimeoutError")
    expect(surfaceReason(error)?.cause?.code).toBe("SQLITE_BUSY_SNAPSHOT")
    expect(Date.now() - start).toBeLessThan(2000)
  })
})

// Regression: only lock timeouts retry. A constraint violation must surface
// immediately; a widened predicate would show up here as slowness.
test("fails fast on a non-lock error", async () => {
  await withDatabase("sqlite-constraint-", async (filename) => {
    await initFile(filename, (native, text) => (native as Database).run(text))

    const start = Date.now()
    let error: unknown
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* db.run(sql`insert into t values (1, 'dup')`)
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
    ).catch((e) => {
      error = e
    })

    expect(error).toBeDefined()
    expect(surfaceReason(error)?._tag).not.toBe("LockTimeoutError")
    expect(Date.now() - start).toBeLessThan(1000)
  })
})

// Regression: while a statement sleeps between lock retries, another fiber
// can open a transaction on the shared connection. An attempt that resumes
// without re-entering the client semaphore runs inside that transaction and
// its writes roll back with it; the fix makes each attempt wait the
// transaction out. The Deferred parks the transaction mid-body so the
// interleaving is ordered by the test, not by sleeps lining up.
test("a retrying statement waits out a transaction opened while it sleeps", async () => {
  await withDatabase("sqlite-race-", async (filename) => {
    await initFile(filename, (native, text) => (native as Database).run(text))
    const lock = new Database(filename)
    lock.run("begin immediate")

    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        ;((yield* Sqlite.Native) as Database).run("pragma busy_timeout = 0")

        // A: a plain autocommit write. Its first attempts fail on the foreign
        // lock; by one second in, it is sleeping between retries.
        const writer = yield* Effect.forkChild(db.run(sql`update t set v = 'after' where id = 1`))
        yield* Effect.sleep("1 second")

        // B: open a transaction on the same client and park inside it on a
        // Deferred. It holds the client semaphore until the test lets go.
        const inside = yield* Deferred.make<void>()
        const transactor = yield* Effect.forkChild(
          db
            .transaction(
              (tx) =>
                Effect.gen(function* () {
                  yield* tx.get(sql`select v from t where id = 1`)
                  yield* Deferred.await(inside)
                  yield* Effect.fail(new Error("rollback requested"))
                }),
              { behavior: "deferred" },
            )
            .pipe(Effect.ignore),
        )
        yield* Effect.sleep("1 second")

        // Free the write lock while B is parked. A's next attempt must now
        // wait for B: if it resumed without the semaphore it would join B's
        // transaction, succeed, and be rolled back below.
        lock.run("commit")
        lock.close()
        yield* Effect.sleep("500 millis")
        yield* Deferred.succeed(inside, undefined)
        yield* Fiber.join(transactor)
        yield* Fiber.join(writer)
      }).pipe(Effect.provide(sqliteLayer({ filename })), Effect.scoped),
    )

    // B rolled back, so the update only survives if A waited B out and landed
    // in autocommit.
    expect(await readValue(filename)).toBe("after")
  })
})
