import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, References } from "effect"
import { SqlClient } from "effect/sql"
import { sqliteLayer as bunSqliteLayer } from "@opencode/core/database/sqlite.bun"
import { sqliteLayer as workerdSqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"

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
      for (let delay = 0; delay < 31; delay++) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const holder = yield* Effect.forkChild(
              Effect.scoped(Effect.andThen(sql.reserve, Effect.andThen(Effect.yieldNow, Effect.yieldNow))),
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

describe("sqlite transaction interrupts", () => {
  test("bun client releases the connection when a queued transaction is interrupted", async () => {
    const leaked = await sweep(
      () => bunSqliteLayer({ filename: ":memory:", disableWAL: true }),
      (sql) => sql.withTransaction(sql`SELECT 2`),
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
