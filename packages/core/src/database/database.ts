export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Cause, Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { rename } from "fs/promises"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

function isCorruptedDatabase(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("file is not a database") || message.includes("database disk image is malformed")
}

const backupCorruptedFiles = (filename: string) =>
  Effect.gen(function* () {
    const timestamp = Date.now()
    const backedUp = yield* Effect.forEach(["", "-wal", "-shm"] as const, (ext) =>
      Effect.tryPromise({
        try: async () => {
          const src = filename + ext
          await rename(src, `${src}.corrupt-${timestamp}`)
          return true
        },
        catch: () => false,
      }).pipe(Effect.orElseSucceed(() => false)),
    )

    if (backedUp.some(Boolean)) {
      yield* Effect.logWarning(`Database corrupted. Backed up to: ${filename}.corrupt-${timestamp}`)
      return
    }

    yield* Effect.logWarning(`Database corrupted, but no files could be moved aside: ${filename}`)
  })

function initializeDb() {
  return Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return Service.of({ db })
  })
}

function baseLayer(filename: string) {
  return Layer.effect(
    Service,
    initializeDb().pipe(Effect.orDie),
  ).pipe(
    Layer.provide(sqliteLayer({ filename, disableWAL: true })),
  )
}

export function layerFromPath(filename: string) {
  return Layer.catchCause(baseLayer(filename), (cause) =>
    isCorruptedDatabase(cause)
      ? Layer.unwrap(
          Effect.gen(function* () {
            yield* backupCorruptedFiles(filename)
            return baseLayer(filename)
          }),
        )
      : Layer.failCause(cause),
  )
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

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
