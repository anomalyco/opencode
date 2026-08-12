import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { SqlError } from "effect/unstable/sql/SqlError"
import { sqliteLayer } from "@opencode-ai/core/database/sqlite.workerd"
import type { DurableObjectStorage } from "@opencode-ai/core/database/sqlite.workerd"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { tempGlobalLayer } from "./fixture/global"

const run = <A, E>(storage: DurableObjectStorage, effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqliteLayer({ storage })), Effect.scoped))

describe("sqlite.workerd", () => {
  test("executes statements with bindings and maps rows to records", async () => {
    const rows = await run(
      makeDurableObjectStorage(),
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`
        yield* sql`INSERT INTO item (id, name) VALUES (${1}, ${"one"}), (${2}, ${"two"})`
        return yield* sql<{ id: number; name: string }>`SELECT id, name FROM item ORDER BY id`
      }),
    )
    expect(rows).toEqual([
      { id: 1, name: "one" },
      { id: 2, name: "two" },
    ])
  })

  test("normalizes ArrayBuffer blob values to Uint8Array", async () => {
    const rows = await run(
      makeDurableObjectStorage(),
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE blob (data BLOB NOT NULL)`
        yield* sql`INSERT INTO blob (data) VALUES (${new Uint8Array([1, 2, 3])})`
        return yield* sql<{ data: Uint8Array }>`SELECT data FROM blob`
      }),
    )
    expect(rows[0].data).toBeInstanceOf(Uint8Array)
    expect(Array.from(rows[0].data)).toEqual([1, 2, 3])
  })

  test("withTransaction commits on success and rolls back on failure", async () => {
    const storage = makeDurableObjectStorage()
    const count = await run(
      storage,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE t (value TEXT NOT NULL)`
        yield* sql.withTransaction(sql`INSERT INTO t (value) VALUES (${"kept"})`)
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO t (value) VALUES (${"discarded"})`
              return yield* Effect.fail("rollback")
            }),
          )
          .pipe(Effect.ignore)
        return yield* sql<{ count: number }>`SELECT count(*) AS count FROM t`
      }),
    )
    expect(count[0].count).toBe(1)
  })

  test("nested withTransaction fails with SqlError", async () => {
    const error = await run(
      makeDurableObjectStorage(),
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE t (value TEXT NOT NULL)`
        return yield* sql
          .withTransaction(sql.withTransaction(sql`INSERT INTO t (value) VALUES (${"nested"})`))
          .pipe(Effect.flip)
      }),
    )
    expect(error).toBeInstanceOf(SqlError)
  })

  test("boots the full database layer with migrations over injected storage", async () => {
    const storage = makeDurableObjectStorage()
    const core = await import("@opencode-ai/core/database/database")
    await Effect.runPromise(
      Effect.scoped(
        Layer.build(
          core.Database.layerFromClient.pipe(Layer.provide(sqliteLayer({ storage })), Layer.provide(tempGlobalLayer)),
        ),
      ),
    )
    const names = storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .toArray()
      .map((row) => row.name)
    expect(names).toContain("migration")
    expect(names).toContain("session_v2")
  })
})
