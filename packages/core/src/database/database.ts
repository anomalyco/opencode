export * as Database from "./database"

import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import path from "path"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export class Service extends Context.Service<Service, DatabaseShape>()("@opencode/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")

    return db
  }),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(SqliteClient.layer({ filename })))
}

export const defaultLayer = Layer.unwrap(
  Effect.gen(function* () {
    return layerFromPath(
      !Flag.OPENCODE_DB
        ? path.join(Global.Path.data, "opencode.db")
        : Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)
          ? Flag.OPENCODE_DB
          : path.join(Global.Path.data, Flag.OPENCODE_DB),
    )
  }),
).pipe(Layer.provide(Global.defaultLayer))
