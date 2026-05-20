import { SqliteClient } from "@effect/sql-sqlite-bun"
import { eq, sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { EffectDrizzleSqlite } from "../src"

const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
})

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()

class Database extends Context.Service<Database, Effect.Success<typeof makeDatabase>>()("@opencode/example/Database") {}

const SqliteLive = SqliteClient.layer({ filename: ":memory:", disableWAL: true })

const DatabaseLive = Layer.effect(Database, makeDatabase).pipe(Layer.provide(SqliteLive))

const createSchema = Effect.gen(function* () {
  const db = yield* Database

  yield* db.run(sql`create table users (id integer primary key autoincrement, name text not null)`)
})

const createUser = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    yield* db.insert(users).values({ name })
  })

const renameUser = (from: string, to: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    yield* db.transaction(
      (tx) =>
        tx
          .insert(users)
          .values({ name: from })
          .pipe(Effect.andThen(tx.update(users).set({ name: to }).where(eq(users.name, from)))),
      { behavior: "immediate" },
    )
  })

const listUsers = Effect.gen(function* () {
  const db = yield* Database

  return yield* db.select().from(users)
})

const program = Effect.gen(function* () {
  yield* createSchema
  yield* createUser("Ada")
  yield* renameUser("Grace", "Grace Hopper")

  return yield* listUsers
})

const rows = await Effect.runPromise(program.pipe(Effect.provide(DatabaseLive), Effect.scoped))

console.log(rows)
