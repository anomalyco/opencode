export * as Postgres from "./postgres.bun.js"

import { sql } from "drizzle-orm"
import type { SQL, SQLWrapper } from "drizzle-orm"
import { PgClient, PgTypes } from "@effect/sql-pg"
import { EffectPgDatabase, makeWithDefaults as makePg } from "drizzle-orm/effect-postgres"
import type { EffectPgQueryEffectHKT } from "drizzle-orm/effect-postgres"
import { PgEffectDeleteBase } from "drizzle-orm/pg-core/effect/delete"
import { PgEffectInsertBase } from "drizzle-orm/pg-core/effect/insert"
import { PgEffectSelectBase } from "drizzle-orm/pg-core/effect/select"
import { PgEffectUpdateBase } from "drizzle-orm/pg-core/effect/update"
import { Effect, Layer, Redacted, Result } from "effect"
import type { SqlClient } from "effect/sql"
import type { EffectSQLiteDatabase } from "./drizzle.js"

/** The Drizzle PostgreSQL database class, under the name the driver seam expects. */
export const EffectDrizzlePostgres = EffectPgDatabase

// PostgreSQL has no PRAGMA surface and always enforces foreign keys.
export const supportsTuningPragmas = false
export const supportsForeignKeyToggle = false

export interface Config {
  readonly url?: string
  readonly maxConnections?: number
  readonly applicationName?: string
}

// int8 as a JS number.
//
// Every millisecond timestamp in this schema is bigint, so this codec is load
// bearing: without it time_created arrives as a bigint and any comparison with
// Date.now() is silently wrong. These values are clocks and row counts, all
// below 2^53, so the conversion is exact.
const int8AsNumber: PgTypes.Codec<number> = {
  encode: (value) => {
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, typeof value === "bigint" ? value : BigInt(Math.trunc(value)), false)
    return Result.succeed(bytes)
  },
  decode: (bytes) => {
    if (bytes.byteLength !== 8) return Result.fail(new PgTypes.CodecError({ message: "int8 expects 8 bytes" }))
    return Result.succeed(Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0)))
  },
}

const registry = PgTypes.makeRegistry()
registry.register(PgTypes.OID.int8, int8AsNumber)

// Pooled client. multiplex lets statements from different fibers share each
// pooled connection, so one long read no longer serializes every other
// request; transactions, streams and LISTEN still reserve a connection.
export const clientLayer = (config: Config): Layer.Layer<SqlClient.SqlClient> =>
  Layer.orDie(
    PgClient.layer({
      url: config.url ? Redacted.make(config.url) : undefined,
      maxConnections: config.maxConnections ?? 8,
      minConnections: 1,
      multiplex: true,
      applicationName: config.applicationName ?? "opencode",
      types: registry,
    }),
  )

export type Query = SQLWrapper | string
export type SqlError = EffectPgQueryEffectHKT["error"]

export interface Shim {
  run(query: Query): Effect.Effect<readonly never[], SqlError>
  all<A = unknown>(query: Query): Effect.Effect<A[], SqlError>
  get<A = unknown>(query: Query): Effect.Effect<A | undefined, SqlError>
  values<A = unknown>(query: Query): Effect.Effect<A[], SqlError>
}

/** A transaction exposes the same helpers as the database it came from. */
export type Transaction = Shim

interface Session {
  execute(query: SQL): Effect.Effect<unknown, SqlError>
  objects(query: SQL): Effect.Effect<unknown[], SqlError>
  arrays(query: SQL): Effect.Effect<unknown[][], SqlError>
}

interface DatabaseLike {
  readonly _: { readonly session: Session }
  transaction<A, E, R>(fn: (tx: Transaction) => Effect.Effect<A, E, R>, config?: unknown): Effect.Effect<A, E, R>
}

const toQuery = (query: Query): SQL => (typeof query === "string" ? sql.raw(query) : (query as SQL))

// Drizzle's PostgreSQL builders are Effects already (they evaluate themselves),
// but they do not expose the SQLite terminal helpers. The whole codebase is
// written against SQLite, so add the three helpers once, on the shared
// prototypes, instead of rewriting hundreds of call sites.
const addTerminals = (proto: object) => {
  Object.assign(proto, {
    run(this: Effect.Effect<unknown, unknown>) {
      return Effect.as(this, [] as const)
    },
    all(this: Effect.Effect<readonly unknown[], unknown>) {
      return this
    },
    get(this: Effect.Effect<readonly unknown[], unknown>) {
      return Effect.map(this, (rows) => rows[0])
    },
  })
}

for (const base of [PgEffectSelectBase, PgEffectInsertBase, PgEffectUpdateBase, PgEffectDeleteBase]) {
  addTerminals(base.prototype)
}

// Adds the SQLite-shaped helpers the rest of the codebase is written against
// (run/all/get/values) to a PostgreSQL database or transaction.
//
// PostgreSQL only exposes execute/arrays/objects; this adapter is the single
// place that difference lives, so the call sites stay untouched. It also
// re-attaches itself to the transaction object, because tx.run(...) is used by
// every migration and by the event bus.
const attached = new WeakSet<object>()

export const attach = <D extends object>(db: D): D & Shim => {
  if (attached.has(db)) return db as D & Shim
  attached.add(db)
  const self = db as unknown as DatabaseLike
  // Bind before Object.assign below shadows it, or the shim's transaction
  // would call itself.
  const baseTransaction = self.transaction.bind(db)
  const all = <A = unknown>(query: Query) => self._.session.objects(toQuery(query)) as Effect.Effect<A[], SqlError>
  const shim: Shim & Pick<DatabaseLike, "transaction"> = {
    run: (query) => self._.session.execute(toQuery(query)).pipe(Effect.as([] as const)),
    all,
    values: <A = unknown>(query: Query) => self._.session.arrays(toQuery(query)) as Effect.Effect<A[], SqlError>,
    get: <A = unknown>(query: Query) => Effect.map(all<A>(query), (rows) => rows[0]),
    transaction: (fn, config) => baseTransaction((tx) => fn(attach(tx as object) as never), config),
  }
  return Object.assign(db, shim) as D & Shim
}

// Drizzle over the pooled client, with the SQLite-shaped helpers attached.
// The database is presented with the SQLite shape the codebase is written
// against. At runtime it is a PostgreSQL database: the SQL dialect, value
// mapping and transaction control all come from PostgreSQL, while the
// schema mirror (bigint for every SQLite integer, text for text, bytea for
// blob) keeps the encodings identical.
//
// The type deliberately stops at EffectSQLiteDatabase: it already declares
// run/all/get/values, and keeping only that shape lets tests that build a
// bare SQLite database hand it to code typed against this service.
export type Database = EffectSQLiteDatabase & { readonly $client: SqlClient.SqlClient }

export const makeWithDefaults = () =>
  Effect.gen(function* () {
    const db = yield* makePg()
    return attach(db) as unknown as Database
  })
