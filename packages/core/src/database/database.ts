export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { EffectDrizzlePg } from "@opencode-ai/effect-drizzle-pg"
import { layer as createSqliteLayer } from "#sqlite"
import { layer as createPgLayer } from "#pg"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { DatabaseDialect } from "./dialect"
import { InstallationChannel } from "../installation/version"
import { LayerNode } from "../effect/layer-node"

const makeSqliteDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeSqliteDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

const sqliteServiceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeSqliteDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.applySqlite(db)

    return { db }
  }).pipe(Effect.orDie),
)

const pgServiceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* EffectDrizzlePg.makeWithDefaults()

    yield* DatabaseMigration.applyPg(db as never)

    return { db: db as unknown as DatabaseShape }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return sqliteServiceLayer.pipe(Layer.provide(createSqliteLayer({ filename })))
}

export function layerFromPgUrl(url: string) {
  return pgServiceLayer.pipe(Layer.provide(createPgLayer(url)))
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "opencode.db")
  return join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const defaultLayer = Layer.unwrap(
  Effect.gen(function* () {
    if (DatabaseDialect.isPostgres()) {
      const url = DatabaseDialect.pgUrl()
      if (!url) throw new Error("OPENCODE_DATABASE_URL is set to a postgres URL but the URL is empty")
      return layerFromPgUrl(url)
    }
    return layerFromPath(path())
  }),
).pipe(Layer.provide(Global.defaultLayer))

export const node = LayerNode.make(layerFromPath(path()), [])
