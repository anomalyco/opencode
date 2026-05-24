import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { eq, sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { EffectDrizzleSqlite } from "../src"

const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
})

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = Effect.gen(function* () {
  const db = yield* EffectDrizzleSqlite.makeWithDefaults()
  yield* db.run(sql`create table users (id integer primary key autoincrement, name text not null)`)
  return db
})

const createMigrationsFolder = async () => {
  const migrationsFolder = await mkdtemp(join(tmpdir(), "effect-drizzle-sqlite-"))
  await mkdir(join(migrationsFolder, "20240101000000_create_migrated_users"), { recursive: true })
  await Bun.write(
    join(migrationsFolder, "20240101000000_create_migrated_users", "migration.sql"),
    "create table migrated_users (id integer primary key autoincrement, name text not null);",
  )
  return migrationsFolder
}

test("selects rows through Effect-yieldable query builders", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.insert(users).values({ name: "Ada" })

      expect(yield* db.select().from(users)).toEqual([{ id: 1, name: "Ada" }])
      expect(yield* db.select({ id: users.id }).from(users).where(eq(users.name, "Ada")).get()).toEqual({ id: 1 })
    }),
  )
})

test("commits successful transactions", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db.transaction((tx) => tx.insert(users).values({ name: "Grace" }), { behavior: "immediate" })

      expect(yield* db.select().from(users)).toEqual([{ id: 1, name: "Grace" }])
    }),
  )
})

test("rolls back failed transactions", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db
        .transaction((tx) =>
          tx
            .insert(users)
            .values({ name: "Linus" })
            .pipe(Effect.andThen(Effect.fail("boom"))),
        )
        .pipe(Effect.ignore)

      expect(yield* db.select().from(users)).toEqual([])
    }),
  )
})

test("rolls back explicit transaction rollback", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      yield* db
        .transaction((tx) =>
          tx
            .insert(users)
            .values({ name: "Barbara" })
            .pipe(Effect.andThen(Effect.fail(tx.rollback()))),
        )
        .pipe(Effect.ignore)

      expect(yield* db.select().from(users)).toEqual([])
    }),
  )
})

test("supports returning and rejects empty update sets", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* makeDb

      const inserted = yield* db.insert(users).values({ name: "Ada" }).returning({ id: users.id, name: users.name })
      expect(inserted).toEqual([{ id: 1, name: "Ada" }])

      const updated = yield* db.update(users).set({ name: "Grace" }).where(eq(users.id, 1)).returning()
      expect(updated).toEqual([{ id: 1, name: "Grace" }])

      const deleted = yield* db.delete(users).where(eq(users.id, 1)).returning({ id: users.id })
      expect(deleted).toEqual([{ id: 1 }])

      expect(() => db.update(users).set({ name: undefined })).toThrow("No values to set")
    }),
  )
})

test("runs migrations once and records migration metadata", async () => {
  const migrationsFolder = await createMigrationsFolder()
  try {
    await run(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()

        yield* EffectDrizzleSqlite.migrate(db, { migrationsFolder })
        yield* EffectDrizzleSqlite.migrate(db, { migrationsFolder })
        yield* db.run(sql`insert into migrated_users (name) values ('Margaret')`)

        expect(yield* db.all<{ name: string }>(sql`select name from migrated_users`)).toEqual([{ name: "Margaret" }])
        expect(yield* db.all<{ name: string | null }>(sql`select name from __drizzle_migrations`)).toEqual([
          { name: "20240101000000_create_migrated_users" },
        ])
      }),
    )
  } finally {
    await rm(migrationsFolder, { recursive: true, force: true })
  }
})
