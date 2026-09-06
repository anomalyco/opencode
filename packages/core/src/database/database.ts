export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { basename, isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

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
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function defaultPath(input: {
  data: string
  channel: string
  executable: string
  disableChannelDb?: string
}) {
  if (input.disableChannelDb === "1" || input.disableChannelDb === "true") {
    return join(input.data, "opencode.db")
  }
  if (basename(input.executable).toLowerCase().replace(/\.exe$/, "") === "opencode2") {
    return join(input.data, "opencode2.db")
  }
  if (["latest", "beta", "prod"].includes(input.channel)) return join(input.data, "opencode.db")
  return join(input.data, `opencode-${input.channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  return defaultPath({
    data: Global.Path.data,
    channel: InstallationChannel,
    executable: process.execPath,
    disableChannelDb: process.env.OPENCODE_DISABLE_CHANNEL_DB,
  })
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
