import { SqliteClient } from "@effect/sql-sqlite-bun"
import { eq, sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import { EffectDrizzleSqlite } from "../src"

const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
})

const program = Effect.gen(function* () {
  const db = yield* EffectDrizzleSqlite.makeWithDefaults()

  yield* db.run(sql`create table users (id integer primary key autoincrement, name text not null)`)
  yield* db.insert(users).values({ name: "Ada" })

  const rows = yield* db.select().from(users).where(eq(users.name, "Ada"))

  yield* db.transaction(
    (tx) =>
      tx
        .insert(users)
        .values({ name: "Grace" })
        .pipe(Effect.andThen(tx.update(users).set({ name: "Grace Hopper" }).where(eq(users.name, "Grace")))),
    { behavior: "immediate" },
  )

  return rows
})

const rows = await Effect.runPromise(
  program.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
)

console.log(rows)
