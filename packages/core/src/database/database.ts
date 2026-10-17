export * as Database from "./database.js"

import { EffectDrizzleSqlite } from "./drizzle.js"
import { sqliteLayer, supportsForeignKeyToggle, supportsTuningPragmas } from "#sqlite"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import type { SqlClient } from "effect/sql"
import { Global } from "@opencode/util/global"
import { closeSync, existsSync, openSync } from "node:fs"
import { chmod } from "node:fs/promises"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const makeDatabase = (prefix: string) => EffectDrizzleSqlite.makeWithDefaults({ tablePrefix: prefix })
type DatabaseShape = Effect.Success<ReturnType<typeof makeDatabase>>

export interface Interface {
  db: DatabaseShape
  /** Prepended to every OpenCode table and index name; empty by default. */
  prefix: string
}

// A plain identifier, since raw migration SQL splices it into quoted names.
// SQLite reserves names that start with `sqlite_`.
const prefixPattern = /^(?!sqlite_)[a-z][a-z0-9_]*$/i

export const Options = Schema.Struct({
  path: Schema.optional(Schema.String),
  /**
   * Stores every OpenCode table and index as `<prefix><name>` so the database
   * can be shared with tables OpenCode does not own. Changing it later starts
   * from an empty namespace; existing tables are not renamed.
   */
  prefix: Schema.optional(Schema.String.check(Schema.isPattern(prefixPattern))),
})
export type Options = typeof Options.Type
export type ClientOptions = Pick<Options, "prefix">

export class Service extends Context.Service<Service, Interface>()("@opencode/storage/Database") {}

// The bootstrap lock is scoped to the database being built, never to this
// module: on workerd every Durable Object in an isolate shares module state, and
// releasing a shared semaphore resumes the waiting object's fiber inside the
// releasing object's I/O context, where its first storage call is rejected as
// cross-object I/O.
const databaseLayer = (lock: Effect.Effect<Semaphore.Semaphore>, prefix = "") =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      if (prefix !== "" && !prefixPattern.test(prefix))
        return yield* Effect.die(new Error(`Invalid database table prefix ${JSON.stringify(prefix)}`))
      const db = yield* makeDatabase(prefix)

      if (supportsTuningPragmas) {
        yield* db.run("PRAGMA journal_mode = WAL")
        yield* db.run("PRAGMA synchronous = NORMAL")
        yield* db.run("PRAGMA busy_timeout = 5000")
        yield* db.run("PRAGMA cache_size = -64000")
        yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
      }
      // Durable Object SQLite always enforces foreign keys and rejects the pragma.
      if (supportsForeignKeyToggle) yield* db.run("PRAGMA foreign_keys = ON")
      const semaphore = yield* lock
      yield* semaphore.withPermit(DatabaseMigration.apply(db, prefix))

      return { db, prefix }
    }).pipe(Effect.orDie),
  )

// Two instances over one file bootstrap the same schema, so file databases
// share a lock per path. Each in-memory database is its own connection.
const locks = new Map<string, Semaphore.Semaphore>()

function lockFor(filename: string) {
  const existing = locks.get(filename)
  if (existing) return existing
  const lock = Semaphore.makeUnsafe(1)
  locks.set(filename, lock)
  return lock
}

export function layer(options: Options = { path: ":memory:" }) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const provide = (filename: string) =>
        databaseLayer(
          filename === ":memory:" ? Semaphore.make(1) : Effect.succeed(lockFor(filename)),
          options.prefix,
        ).pipe(Layer.provide(sqliteLayer({ filename })))
      const filename = options.path ?? ":memory:"
      if (filename === ":memory:") return provide(filename)
      const file = isAbsolute(filename) ? filename : join((yield* Global.Service).data, filename)
      yield* Effect.promise(() => restrictToOwner(file))
      return provide(file)
    }),
  )
}

// SQLite creates new sidecars with the database's mode, but does not tighten existing sidecars.
// Windows relies on the user profile directory's inherited ACLs instead of POSIX modes.
async function restrictToOwner(filename: string) {
  if (process.platform === "win32") return
  // Opening and closing an existing database can release another connection's POSIX locks.
  // Create missing files synchronously so another fiber cannot open one before it is restricted.
  if (!existsSync(filename)) closeSync(openSync(filename, "a", 0o600))
  await chmod(filename, 0o600)
  await Promise.all(
    [`${filename}-wal`, `${filename}-shm`].map((file) =>
      chmod(file, 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
      }),
    ),
  )
}

// The database service over an injected SqlClient, for runtimes that receive
// database storage instead of opening a filesystem path. Any client provided
// here still goes through the pragma guards and migrations; Global is required
// because migrations may read it (the v1 import). The lock is created per build
// because every Durable Object builds this layer over its own storage.
export function layerFromClient(
  options: ClientOptions = {},
): Layer.Layer<Service, never, SqlClient.SqlClient | Global.Service> {
  return databaseLayer(Semaphore.make(1), options.prefix)
}

export function configured(options?: Options) {
  return makeGlobalNode({ service: Service, layer: layer(options), deps: [Global.node] })
}

/** `configured`, but over an injected SqlClient layer instead of a filesystem path. */
export function configuredClient(client: Layer.Layer<SqlClient.SqlClient>, options?: ClientOptions) {
  return makeGlobalNode({
    service: Service,
    layer: layerFromClient(options).pipe(Layer.provide(client)),
    deps: [Global.node],
  })
}

export const node = configured({ path: ":memory:" })
