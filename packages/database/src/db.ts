import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import type { EffectSQLiteDatabase } from "@opencode-ai/effect-drizzle-sqlite/effect-sqlite"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()
export type DatabaseShape = Effect.Success<typeof makeDb>

export interface DatabaseInterface {
  readonly db: DatabaseShape
}

export class Database extends Context.Service<Database, DatabaseInterface>()("@opencode-ai/database/Database") {
  static layerMemory = Layer.effect(
    Database,
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* db.$client`PRAGMA foreign_keys = ON`
      return Database.of({ db })
    }),
  ).pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })))

  static layerLive = (filename: string) =>
    Layer.effect(
      Database,
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.$client`PRAGMA foreign_keys = ON`
        return Database.of({ db })
      }),
    ).pipe(Layer.provide(SqliteClient.layer({ filename, disableWAL: true })))
}
