export * as Database from "./database"

import { EffectDrizzleSqlite } from "@kancode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { existsSync, renameSync } from "fs"
import { Global } from "../global"
import { envAlias, Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@kancode/v2/storage/Database") {}

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

function useSharedDatabaseName() {
  const disableChannelDb = envAlias("DISABLE_CHANNEL_DB")?.toLowerCase()
  return (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    disableChannelDb === "1" ||
    disableChannelDb === "true"
  )
}

function channelSuffix() {
  return InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
}

function databaseBasename(prefix: string) {
  if (useSharedDatabaseName()) return `${prefix}.db`
  return `${prefix}-${channelSuffix()}.db`
}

/** Default on-disk name: the app's persistent SQLite store. */
export function filename() {
  return databaseBasename("storage")
}

const LEGACY_PREFIXES = ["kancode", "opencode"] as const

/** One-time rename from older branded filenames so existing installs keep data. */
export function adoptLegacyDatabase(from: string, to: string) {
  if (from === to || existsSync(to) || !existsSync(from)) return
  renameSync(from, to)
  for (const suffix of ["-wal", "-shm"]) {
    const source = `${from}${suffix}`
    if (!existsSync(source) || existsSync(`${to}${suffix}`)) continue
    renameSync(source, `${to}${suffix}`)
  }
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  const next = join(Global.Path.data, filename())
  for (const prefix of LEGACY_PREFIXES) {
    adoptLegacyDatabase(join(Global.Path.data, databaseBasename(prefix)), next)
  }
  return next
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
