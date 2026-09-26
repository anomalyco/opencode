import { describe, expect, test } from "bun:test"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { tmpdir } from "./fixture/tmpdir"

// The split driver aliases its reader connection to the writer for :memory: databases,
// so these tests must use a real file to exercise the second connection.
const run = <A, E>(filename: string, effect: Effect.Effect<A, E, Database.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Database.layerFromPath(filename))))

describe("SqliteReadWriteSplit", () => {
  test("plain reads see committed writes through the reader connection", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "split.sqlite")
    await run(
      filename,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run(sql`CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`)
        yield* db.run(sql`INSERT INTO probe (id, value) VALUES (1, 'committed')`)
        expect(yield* db.get(sql`SELECT value FROM probe WHERE id = 1`)).toEqual({ value: "committed" })
      }),
    )
  })

  test("reads inside a transaction see uncommitted rows from the same connection", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "split.sqlite")
    await run(
      filename,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run(sql`CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`)
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.run(sql`INSERT INTO probe (id, value) VALUES (1, 'uncommitted')`)
            expect(yield* tx.get(sql`SELECT value FROM probe WHERE id = 1`)).toEqual({ value: "uncommitted" })
          }),
        )
        expect(yield* db.get(sql`SELECT value FROM probe WHERE id = 1`)).toEqual({ value: "uncommitted" })
      }),
    )
  })

  test("a rollback hides uncommitted rows from the reader connection", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "split.sqlite")
    await run(
      filename,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run(sql`CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`)
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.run(sql`INSERT INTO probe (id, value) VALUES (1, 'rollback')`)
              return yield* Effect.die(new Error("rollback"))
            }),
          )
          .pipe(Effect.catchCause(() => Effect.void))
        expect(yield* db.get(sql`SELECT COUNT(*) AS count FROM probe`)).toEqual({ count: 0 })
      }),
    )
  })
})
