import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, References } from "effect"
import { SqlClient } from "effect/sql"
import { sql } from "drizzle-orm"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { sqliteLayer as bunSqliteLayer } from "@opencode/core/database/sqlite.bun"
import { sqliteLayer as workerdSqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { TestDatabase } from "./lib/database"

// The holder keeps the connection across yields, so the queued fiber parks in
// the semaphore's waiter queue and is woken when the holder lets go. The sweep
// moves the interrupt across that wait and the gap between the woken fiber
// taking the connection's only permit and registering its release. A leaked
// permit makes every later query wait forever.
const sweep = (
  layer: () => Layer.Layer<SqlClient.SqlClient>,
  queue: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const leaked: Array<number> = []
      for (let delay = 0; delay < 45; delay++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const holder = yield* Effect.forkChild(
              Effect.scoped(
                Effect.andThen(
                  sql.reserve,
                  Effect.forEach(Array.from({ length: 22 }), () => Effect.yieldNow, { discard: true }),
                ),
              ),
            )
            const queued = yield* queue(sql).pipe(
              Effect.provideService(References.MaxOpsBeforeYield, 3),
              Effect.forkChild,
            )
            for (let i = 0; i < delay; i++) yield* Effect.yieldNow
            yield* Fiber.interrupt(queued)
            yield* Fiber.join(holder)
            const next = yield* Effect.forkChild(sql`SELECT 3`, { startImmediately: true })
            if (next.pollUnsafe() === undefined) {
              leaked.push(delay)
              yield* Fiber.interrupt(next)
            }
          }).pipe(Effect.provide(layer())),
        )
      }
      return leaked
    }),
  )

// The Node client is swept in fixture/sqlite-node-client.ts under real Node,
// because @effect/sql-sqlite-node cannot load inside `bun test` on macOS. It
// shares makeSqliteAcquirers with the Bun client.
describe("sqlite transaction interrupts", () => {
  test("bun client releases the connection when a queued transaction is interrupted", async () => {
    const leaked = await sweep(
      () => bunSqliteLayer({ filename: ":memory:", disableWAL: true }),
      (sql) => sql.withTransaction(sql`SELECT 2`),
    )
    expect(leaked).toEqual([])
  })

  test("bun client releases the connection when a queued drizzle transaction is interrupted", async () => {
    const leaked = await sweep(
      () => bunSqliteLayer({ filename: ":memory:", disableWAL: true }),
      (client) =>
        EffectDrizzleSqlite.makeWithDefaults().pipe(
          Effect.provideService(SqlClient.SqlClient, client),
          Effect.provideService(References.MaxOpsBeforeYield, 2048),
          Effect.flatMap((db) => db.transaction((tx) => tx.run(sql`SELECT 2`))),
        ),
    )
    expect(leaked).toEqual([])
  })

  test("bun client releases the connection when a queued reserve is interrupted", async () => {
    const leaked = await sweep(
      () => bunSqliteLayer({ filename: ":memory:", disableWAL: true }),
      (sql) => Effect.scoped(Effect.andThen(sql.reserve, Effect.yieldNow)),
    )
    expect(leaked).toEqual([])
  })

  test("template client releases the connection when a queued transaction is interrupted", async () => {
    const leaked = await sweep(
      () => TestDatabase.client,
      (sql) => sql.withTransaction(sql`SELECT 2`),
    )
    expect(leaked).toEqual([])
  })

  test("workerd client releases the connection when a queued reserve is interrupted", async () => {
    const leaked = await sweep(
      () => workerdSqliteLayer({ storage: makeDurableObjectStorage() }),
      (sql) => Effect.scoped(Effect.andThen(sql.reserve, Effect.yieldNow)),
    )
    expect(leaked).toEqual([])
  })

  test("workerd client releases the connection when a queued transaction is interrupted", async () => {
    const leaked = await sweep(
      () => workerdSqliteLayer({ storage: makeDurableObjectStorage() }),
      (sql) => sql.withTransaction(sql`SELECT 2`),
    )
    expect(leaked).toEqual([])
  })
})
