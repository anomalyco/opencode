import { SqliteClient } from "@effect/sql-sqlite-bun"
import { eq } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { EffectDrizzleSqlite } from "../src"

const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
})

type User = typeof users.$inferSelect

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

const sqliteLayer = SqliteClient.layer({ filename: ":memory:", disableWAL: true })

class Database extends Context.Service<Database, DatabaseShape>()("@opencode/example/Database") {
  static layer = Layer.effect(Database, makeDatabase).pipe(Layer.provide(sqliteLayer))
}

class UserStoreError extends Schema.TaggedErrorClass<UserStoreError>()("UserStoreError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

const mapStoreError = (message: string) => (cause: unknown) => new UserStoreError({ message, cause })

interface UserStoreShape {
  migrate(): Effect.Effect<void, UserStoreError>
  create(name: string): Effect.Effect<void, UserStoreError>
  rename(from: string, to: string): Effect.Effect<void, UserStoreError>
  list(): Effect.Effect<User[], UserStoreError>
}

class UserStore extends Context.Service<UserStore, UserStoreShape>()("@opencode/example/UserStore") {
  static layer = Layer.effect(
    UserStore,
    Effect.gen(function* () {
      const db = yield* Database

      return UserStore.of({
        migrate: Effect.fn("UserStore.migrate")(function* () {
          yield* EffectDrizzleSqlite.migrate(db, { migrationsFolder: `${import.meta.dirname}/migrations` }).pipe(
            Effect.mapError((cause) => new UserStoreError({ message: "Failed to migrate users", cause })),
          )
        }),
        create: Effect.fn("UserStore.create")(function* (name: string) {
          yield* db
            .insert(users)
            .values({ name })
            .pipe(Effect.asVoid, Effect.mapError(mapStoreError("Failed to create user")))
        }),
        rename: Effect.fn("UserStore.rename")(function* (from: string, to: string) {
          yield* db
            .transaction(
              Effect.fnUntraced(function* (tx) {
                yield* tx.insert(users).values({ name: from })
                yield* tx.update(users).set({ name: to }).where(eq(users.name, from))
              }),
              { behavior: "immediate" },
            )
            .pipe(Effect.asVoid, Effect.mapError(mapStoreError("Failed to rename user")))
        }),
        list: Effect.fn("UserStore.list")(function* () {
          return yield* db
            .select()
            .from(users)
            .pipe(Effect.mapError(mapStoreError("Failed to list users")))
        }),
      })
    }),
  ).pipe(Layer.provide(Database.layer))
}

const program = Effect.gen(function* () {
  const userStore = yield* UserStore

  yield* userStore.migrate()
  yield* userStore.create("Ada")
  yield* userStore.rename("Grace", "Grace Hopper")

  return yield* userStore.list()
})

const rows = await Effect.runPromise(program.pipe(Effect.provide(UserStore.layer)))

console.log(rows)
