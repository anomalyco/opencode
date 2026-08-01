import { describe, expect, test } from "bun:test"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { tmpdir } from "./fixture/tmpdir"

describe("Database", () => {
  test("concurrent initialization of the same database file succeeds", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "concurrent.sqlite")
    const open = (layer: Layer.Layer<Database.Service>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          yield* db.run(sql`SELECT 1`)
        }).pipe(Effect.provide(layer)),
      )
    // Two independent connections to the same database file must both apply the
    // WAL + busy_timeout PRAGMAs and initialize without locking each other out.
    const layers = [Database.layerFromPath(filename), Database.layerFromPath(filename)]
    await Effect.runPromise(Effect.all(layers.map(open), { concurrency: "unbounded", discard: true }))
  })

  test("concurrent transactions on separate handles serialize instead of SQLITE_BUSY", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "transaction.sqlite")
    const one = Database.layerFromPath(filename)
    const two = Database.layerFromPath(filename)

    const writeBump = (layer: Layer.Layer<Database.Service>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          yield* db.transaction((tx) => tx.run(sql`UPDATE counter SET value = value + 1 WHERE id = 'n'`))
        }).pipe(Effect.provide(layer)),
      )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { db: dbA } = yield* Database.Service
          yield* dbA.run(sql`CREATE TABLE counter (id TEXT PRIMARY KEY, value INTEGER NOT NULL)`)
          yield* dbA.run(sql`INSERT INTO counter (id, value) VALUES ('n', 0)`)

          // Two write transactions from separate connections contend for the same
          // row. With busy_timeout configured, the second writer must wait rather
          // than failing immediately with SQLITE_BUSY.
          yield* Effect.all([writeBump(one), writeBump(two)], { concurrency: "unbounded", discard: true })

          expect(yield* dbA.get<{ value: number }>(sql`SELECT value FROM counter WHERE id = 'n'`)).toEqual({
            value: 2,
          })
        }).pipe(Effect.provide(one)),
      ),
    )
  })
})
