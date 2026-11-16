import path from "node:path"
import { Database } from "bun:sqlite"
import { expect } from "bun:test"
import { sql } from "drizzle-orm"
import { Cause, Effect } from "effect"
import { SqlClient } from "effect/sql"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { sqliteLayer } from "@opencode/core/database/sqlite.bun"
import { StorageFailure } from "@opencode/core/database/storage-failure"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// The node:sqlite driver is covered by sqlite-node.test.ts, which runs under Node.
const large = "x".repeat(60_000)

it.live("a transaction SQLite rolled back itself fails with the storage failure, not the rollback", () =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* client`CREATE TABLE probe (value TEXT)`
    yield* client`PRAGMA max_page_count = 1`

    const cause = yield* db
      .transaction(() => db.run(sql`INSERT INTO probe VALUES (${large})`), { behavior: "immediate" })
      .pipe(Effect.sandbox, Effect.flip)
    expect(StorageFailure.message(cause)).toBe("Storage is full")
    // Nothing was left open: the connection takes the next transaction.
    yield* client`PRAGMA max_page_count = 1073741823`
    yield* db.transaction(() => db.run(sql`INSERT INTO probe VALUES ('ok')`))
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
)

it.live("a full database is a storage failure for a statement and for a query", () =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* client`CREATE TABLE probe (value TEXT)`
    // SQLite never lowers the limit below the current size, so 1 means the database may not grow.
    yield* client`PRAGMA max_page_count = 1`

    const statement = yield* client`INSERT INTO probe VALUES (${large})`.pipe(Effect.flip)
    expect(StorageFailure.fromSqlError(statement)).toBe("Storage is full")
    expect(StorageFailure.message(Cause.fail(statement))).toBe("Storage is full")

    const query = yield* db.run(sql`INSERT INTO probe VALUES (${large})`).pipe(Effect.flip)
    expect(StorageFailure.message(Cause.die(query))).toBe("Storage is full")
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
)

it.live("an extended result code is a storage failure by its primary code", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const filename = path.join(dir.path, "probe.db")
    yield* Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient
      yield* client`CREATE TABLE probe (value TEXT)`
      // SQLITE_BUSY_SNAPSHOT (517): a WAL reader can't become the writer once another connection has committed.
      yield* client`BEGIN`
      yield* client`SELECT * FROM probe`
      yield* Effect.sync(() => {
        const other = new Database(filename)
        other.run("INSERT INTO probe VALUES ('other')")
        other.close()
      })
      const error = yield* client`INSERT INTO probe VALUES ('mine')`.pipe(Effect.flip)
      yield* client`ROLLBACK`
      expect(error.reason.cause).toMatchObject({ errno: 517 })
      expect(StorageFailure.fromSqlError(error)).toBe("Storage is in use by another process")
    }).pipe(Effect.provide(sqliteLayer({ filename })))
  }),
)

it.live("a constraint, a bad statement and other defects are not storage failures", () =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* client`CREATE TABLE probe (id TEXT PRIMARY KEY)`
    yield* client`INSERT INTO probe VALUES ('a')`

    const constraint = yield* client`INSERT INTO probe VALUES ('a')`.pipe(Effect.flip)
    expect(StorageFailure.fromSqlError(constraint)).toBeUndefined()
    const missing = yield* db.run(sql`SELECT * FROM missing`).pipe(Effect.flip)
    expect(StorageFailure.message(Cause.die(missing))).toBeUndefined()

    expect(StorageFailure.message(Cause.die(new Error("database or disk is full")))).toBeUndefined()
    expect(StorageFailure.message(Cause.interrupt())).toBeUndefined()
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" }))),
)
