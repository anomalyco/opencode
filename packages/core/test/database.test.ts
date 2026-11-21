import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { sql } from "drizzle-orm"
import { chmod, stat, writeFile } from "node:fs/promises"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, Statement } from "effect/sql"
import { ConstraintError, LockTimeoutError, SqlError } from "effect/sql/SqlError"
import { TestClock } from "effect/testing"
import { isTransientSqliteLockError, STEADY_BUSY_TIMEOUT_MS } from "@opencode/core/database/boot-lock"
import { layer, layerFromClient, Service } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// Read while the connection is open: SQLite may remove the sidecars on close.
const openModes = (filename: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Layer.build(layer({ path: filename }))
      return yield* Effect.promise(() =>
        Promise.all(["", "-wal", "-shm"].map(async (suffix) => (await stat(filename + suffix)).mode & 0o777)),
      )
    }).pipe(Effect.scoped, Effect.provideService(Global.Service, Global.make({ data: path.dirname(filename) }))),
  )

describe.skipIf(process.platform === "win32")("Database file permissions", () => {
  test("creates the database and sidecars readable only by the owner", async () => {
    await using tmp = await tmpdir()

    expect(await openModes(path.join(tmp.path, "opencode.db"))).toEqual([0o600, 0o600, 0o600])
  })

  test("tightens an existing database and sidecars", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    await Promise.all(
      ["", "-wal", "-shm"].map(async (suffix) => {
        await writeFile(filename + suffix, "")
        await chmod(filename + suffix, 0o644)
      }),
    )

    expect(await openModes(filename)).toEqual([0o600, 0o600, 0o600])
  })
})

describe("Database boot lock recovery", () => {
  test("classifies transient SQLite lock errors without matching permanent failures", () => {
    const lockSqlError = new SqlError({
      reason: new LockTimeoutError({ cause: new Error("database is locked"), message: "busy", operation: "execute" }),
    })
    const drizzleLockError = new EffectDrizzleQueryError({
      query: "PRAGMA journal_mode = WAL",
      params: [],
      cause: Cause.fail(lockSqlError),
    })
    const constraintSqlError = new SqlError({
      reason: new ConstraintError({ cause: new Error("UNIQUE constraint failed"), operation: "execute" }),
    })

    expect(isTransientSqliteLockError(lockSqlError)).toBe(true)
    expect(isTransientSqliteLockError(drizzleLockError)).toBe(true)
    expect(isTransientSqliteLockError(Object.assign(new Error("busy"), { errno: 261 }))).toBe(true)
    expect(isTransientSqliteLockError(Object.assign(new Error("locked"), { errcode: 6 }))).toBe(true)
    expect(isTransientSqliteLockError(Object.assign(new Error("busy"), { code: "SQLITE_BUSY_RECOVERY" }))).toBe(true)
    expect(isTransientSqliteLockError(new Error("SQLiteError: database is locked"))).toBe(true)

    expect(isTransientSqliteLockError(constraintSqlError)).toBe(false)
    expect(isTransientSqliteLockError(Object.assign(new Error("disk full"), { errno: 13 }))).toBe(false)
    expect(isTransientSqliteLockError(Object.assign(new Error("corrupt"), { errno: 11 }))).toBe(false)
    expect(isTransientSqliteLockError(new Error("syntax error"))).toBe(false)
    expect(isTransientSqliteLockError(Cause.interrupt())).toBe(false)
  })

  test("retries transient BEGIN EXCLUSIVE locks on a fresh database without blocking the event loop", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    const holder = new Database(filename)
    holder.run("BEGIN EXCLUSIVE")

    let ticksWhileLocked = 0
    let released = false
    const timer = setInterval(() => {
      if (!released) ticksWhileLocked += 1
    }, 50)
    const release = setTimeout(() => {
      released = true
      holder.run("COMMIT")
      holder.close()
    }, 500)

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* Service
          const journal = yield* database.db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)
          const timeout = yield* database.db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`)
          const table = yield* database.db.get<{ name: string }>(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'`,
          )
          return { journal: journal?.journal_mode, timeout: timeout?.timeout, table: table?.name }
        }).pipe(
          Effect.provide(layer({ path: filename })),
          Effect.provideService(Global.Service, Global.make({ data: tmp.path })),
        ),
      )

      expect(result).toEqual({
        journal: "wal",
        timeout: STEADY_BUSY_TIMEOUT_MS,
        table: "session_v2",
      })
      expect(ticksWhileLocked).toBeGreaterThan(0)
    } finally {
      clearTimeout(release)
      clearInterval(timer)
      if (!released) {
        if (holder.inTransaction) holder.run("ROLLBACK")
        holder.close()
      }
    }
  })

  test("retries transient exclusive locks on an existing WAL database", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "opencode.db")
    const global = Global.make({ data: tmp.path })

    await Effect.runPromise(
      Effect.scoped(Layer.build(layer({ path: filename }))).pipe(Effect.provideService(Global.Service, global)),
    )

    const holder = new Database(filename)
    holder.run("PRAGMA locking_mode = EXCLUSIVE")
    holder.run("BEGIN EXCLUSIVE")
    holder.run("INSERT INTO kv (key, value, time_created, time_updated) VALUES ('boot-lock-test', '1', 1, 1)")

    let ticksWhileLocked = 0
    let released = false
    const timer = setInterval(() => {
      if (!released) ticksWhileLocked += 1
    }, 50)
    const release = setTimeout(() => {
      released = true
      holder.run("COMMIT")
      holder.run("PRAGMA locking_mode = NORMAL")
      holder.close()
    }, 500)

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const database = yield* Service
          const journal = yield* database.db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)
          const timeout = yield* database.db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`)
          const row = yield* database.db.get<{ value: string }>(sql`SELECT value FROM kv WHERE key = 'boot-lock-test'`)
          return { journal: journal?.journal_mode, timeout: timeout?.timeout, value: row?.value }
        }).pipe(Effect.provide(layer({ path: filename })), Effect.provideService(Global.Service, global)),
      )

      expect(result).toEqual({ journal: "wal", timeout: STEADY_BUSY_TIMEOUT_MS, value: "1" })
      expect(ticksWhileLocked).toBeGreaterThan(0)
    } finally {
      clearTimeout(release)
      clearInterval(timer)
      if (!released) {
        if (holder.inTransaction) holder.run("ROLLBACK")
        holder.close()
      }
    }
  })

  it.effect("retries transient lock errors during pragma and migration setup via layerFromClient", () =>
    Effect.gen(function* () {
      let failures = 0
      const failedOnce = yield* Deferred.make<void>()
      const failingClient = Layer.effect(
        SqlClient.SqlClient,
        Effect.gen(function* () {
          const client = yield* SqlClient.SqlClient
          const connection = yield* client.reserve
          const intercept = <A>(effect: Effect.Effect<A, SqlError>) =>
            Effect.suspend(() => {
              if (failures < 3) {
                failures += 1
                return Deferred.succeed(failedOnce, undefined).pipe(
                  Effect.andThen(
                    Effect.fail(
                      new SqlError({
                        reason: new LockTimeoutError({
                          cause: new Error("database is locked"),
                          message: "database is locked",
                          operation: "execute",
                        }),
                      }),
                    ),
                  ),
                )
              }
              return effect
            })
          return yield* SqlClient.make({
            acquirer: Effect.succeed({
              ...connection,
              execute: (query, params, transform) => intercept(connection.execute(query, params, transform)),
              executeRaw: (query, params) => intercept(connection.executeRaw(query, params)),
            }),
            compiler: Statement.makeCompilerSqlite(),
            driver: client.driver,
            spanAttributes: [],
          })
        }),
      ).pipe(
        Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
        Layer.provide(Reactivity.layer),
      )

      const fiber = yield* Effect.forkChild(
        Effect.scoped(
          Effect.gen(function* () {
            const database = yield* Service
            return yield* database.db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`)
          }).pipe(Effect.provide(layerFromClient.pipe(Layer.provide(failingClient)))),
        ),
        { startImmediately: true },
      )

      yield* Deferred.await(failedOnce)
      for (let step = 0; step < 5; step++) {
        yield* Effect.yieldNow
        yield* TestClock.adjust("500 millis")
      }
      const timeout = yield* Fiber.join(fiber)

      expect(failures).toBe(3)
      expect(timeout).toEqual({ timeout: STEADY_BUSY_TIMEOUT_MS })
    }).pipe(Effect.provideService(Global.Service, Global.make({ data: path.join(process.cwd(), ".test-data") }))),
  )

  it.effect("does not retry non-lock SQLite errors during boot", () =>
    Effect.gen(function* () {
      let attempts = 0
      const failingClient = Layer.effect(
        SqlClient.SqlClient,
        Effect.gen(function* () {
          const client = yield* SqlClient.SqlClient
          const connection = yield* client.reserve
          const fail = () =>
            Effect.suspend(() => {
              attempts += 1
              return Effect.fail(
                new SqlError({
                  reason: new ConstraintError({
                    cause: new Error("constraint failed"),
                    message: "constraint failed",
                    operation: "execute",
                  }),
                }),
              )
            })
          return yield* SqlClient.make({
            acquirer: Effect.succeed({
              ...connection,
              execute: () => fail(),
              executeRaw: () => fail(),
            }),
            compiler: Statement.makeCompilerSqlite(),
            driver: client.driver,
            spanAttributes: [],
          })
        }),
      ).pipe(
        Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
        Layer.provide(Reactivity.layer),
      )

      const exit = yield* Effect.scoped(Layer.build(layerFromClient.pipe(Layer.provide(failingClient)))).pipe(
        Effect.exit,
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(attempts).toBe(1)
    }).pipe(Effect.provideService(Global.Service, Global.make({ data: path.join(process.cwd(), ".test-data") }))),
  )
})
