// Bundled for Node by sqlite-node.test.ts and run with `node <dir>`, so #sqlite
// resolves to the node:sqlite client that the standalone Node build ships.
import { join } from "node:path"
import { Global } from "@opencode/util/global"
import { sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Cause, Effect, Fiber, Layer, References } from "effect"
import { SqlClient } from "effect/sql"
import { isSqlError } from "effect/sql/SqlError"
import { Database } from "../../src/database/database"
import { sqliteLayer } from "../../src/database/sqlite.node"

const typed = sqliteTable("typed", { id: integer().primaryKey(), name: text().notNull() })

// Same sweep as sqlite-interrupt.test.ts. It runs here because
// @effect/sql-sqlite-node cannot load inside `bun test` on macOS.
const sweep = (queue: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>) =>
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
        }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:", disableWAL: true }))),
      )
    }
    return leaked
  })

const dir = process.argv[2]!

const program = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const journal = yield* db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)
  yield* db.run(sql`CREATE TABLE probe (id TEXT PRIMARY KEY)`)
  yield* db.transaction((tx) =>
    Effect.all([tx.run(sql`INSERT INTO probe (id) VALUES ('a')`), tx.run(sql`INSERT INTO probe (id) VALUES ('b')`)]),
  )
  const error = yield* db.run(sql`INSERT INTO probe (id) VALUES ('a')`).pipe(Effect.flip)
  const cause = Cause.isCause(error.cause) ? Cause.squash(error.cause) : error.cause
  const rows = yield* db.all<{ count: number }>(sql`SELECT count(*) AS count FROM probe`)

  yield* db.run(sql`CREATE TABLE typed (id integer PRIMARY KEY, name text NOT NULL)`)
  const inserted = yield* db.insert(typed).values({ id: 1, name: "Ada" }).returning()
  const duplicate = yield* db.insert(typed).values({ id: 1, name: "Bob" }).returning().pipe(Effect.flip)
  const afterFailure = yield* db.select().from(typed)
  const raw = yield* db.get<{ count: number }>(sql`SELECT count(*) AS count FROM typed`)

  const leakedTransaction = yield* sweep((client) => client.withTransaction(client`SELECT 2`))
  const leakedReserve = yield* sweep((client) => Effect.scoped(Effect.andThen(client.reserve, Effect.yieldNow)))
  return {
    journal: journal?.journal_mode,
    reason: isSqlError(cause) ? cause.reason._tag : "not a SqlError",
    rows: rows[0]?.count,
    inserted,
    duplicate: duplicate._tag,
    afterFailure,
    raw: raw?.count,
    leakedTransaction,
    leakedReserve,
  }
})

const global = Global.layerWith({
  data: dir,
  cache: dir,
  config: dir,
  state: dir,
  tmp: dir,
  bin: dir,
  log: dir,
  repos: dir,
})

const database = Database.layer({ path: join(dir, "opencode.db") }).pipe(Layer.provide(global))
console.log(JSON.stringify(await Effect.runPromise(program.pipe(Effect.provide(database)))))
