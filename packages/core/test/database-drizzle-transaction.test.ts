import path from "node:path"
import { Database } from "bun:sqlite"
import { expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// Another process writing the same file without waiting for the lock. Returns its error message, if it failed.
const writeFromOtherConnection = (filename: string, value: string) =>
  Effect.sync(() => {
    const other = new Database(filename)
    try {
      other.run("PRAGMA busy_timeout = 0")
      other.run("INSERT INTO probe VALUES (?)", [value])
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    } finally {
      other.close()
    }
  })

it.live("a transaction without a behavior takes the write lock when it begins", () =>
  Effect.gen(function* () {
    const filename = path.join((yield* tmpdirScoped()).path, "probe.db")
    yield* Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* db.run(sql`CREATE TABLE probe (value TEXT)`)

      // A deferred BEGIN reads a WAL snapshot first; once another connection commits, the write that follows
      // fails with SQLITE_BUSY_SNAPSHOT however long busy_timeout is.
      const other = yield* db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx.all(sql`SELECT * FROM probe`)
          const other = yield* writeFromOtherConnection(filename, "other")
          yield* tx.run(sql`INSERT INTO probe VALUES ('mine')`)
          return other
        }),
      )

      expect(other).toContain("database is locked")
      expect(yield* db.all(sql`SELECT value FROM probe`)).toEqual([{ value: "mine" }])
    }).pipe(Effect.provide(sqliteLayer({ filename })))
  }),
)

it.live("a deferred transaction lets other connections write while it reads", () =>
  Effect.gen(function* () {
    const filename = path.join((yield* tmpdirScoped()).path, "probe.db")
    yield* Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* db.run(sql`CREATE TABLE probe (value TEXT)`)

      const other = yield* db.transaction(
        (tx) =>
          tx.all(sql`SELECT * FROM probe`).pipe(Effect.andThen(writeFromOtherConnection(filename, "other"))),
        { behavior: "deferred" },
      )

      expect(other).toBeUndefined()
      expect(yield* db.all(sql`SELECT value FROM probe`)).toEqual([{ value: "other" }])
    }).pipe(Effect.provide(sqliteLayer({ filename })))
  }),
)

it.live("concurrent nested transactions roll back only their own writes", () =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run(sql`CREATE TABLE probe (value TEXT)`)

    // The yields interleave the two savepoints on the one connection the transaction holds.
    yield* db.transaction((tx) =>
      Effect.all(
        [
          tx
            .transaction((inner) =>
              inner.run(sql`INSERT INTO probe VALUES ('failed')`).pipe(
                Effect.andThen(Effect.yieldNow),
                Effect.andThen(Effect.yieldNow),
                Effect.andThen(Effect.fail("boom")),
              ),
            )
            .pipe(Effect.ignore),
          tx.transaction((inner) =>
            Effect.yieldNow.pipe(
              Effect.andThen(inner.run(sql`INSERT INTO probe VALUES ('kept')`)),
              Effect.andThen(Effect.yieldNow),
              Effect.andThen(inner.transaction((deeper) => deeper.run(sql`INSERT INTO probe VALUES ('deeper')`))),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      ),
    )

    expect(yield* db.all(sql`SELECT value FROM probe ORDER BY value`)).toEqual([{ value: "deeper" }, { value: "kept" }])
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
)

it.live("interrupting a transaction that waits for the connection does not wait for the holder", () =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run(sql`CREATE TABLE probe (value TEXT)`)
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const ran = yield* Ref.make(false)

    const holder = yield* db
      .transaction(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))))
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    const queued = yield* db.transaction(() => Ref.set(ran, true)).pipe(Effect.forkChild({ startImmediately: true }))
    const interrupting = yield* Fiber.interrupt(queued).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Effect.yieldNow
    const interrupted = interrupting.pollUnsafe() !== undefined

    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(holder)
    yield* Fiber.join(interrupting)
    expect(interrupted).toBe(true)
    expect(yield* Ref.get(ran)).toBe(false)
    // The connection is free for the next transaction.
    yield* db.transaction((tx) => tx.run(sql`INSERT INTO probe VALUES ('next')`))
    expect(yield* db.all(sql`SELECT value FROM probe`)).toEqual([{ value: "next" }])
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
)
