export * as TestDatabase from "./database"

import Sqlite, { type SQLQueryBindings } from "bun:sqlite"
import { Database } from "@opencode/core/database/database"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Semaphore, Stream } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, Statement } from "effect/sql"
import type { SqlConnection } from "effect/sql"
import { classifySqliteError, SqlError } from "effect/sql/SqlError"

// Bootstrapping the schema runs ~14 ms per database. Each test database instead deserializes its own copy of
// one migrated template. Every copy still goes through Database.layerFromClient so it gets the production
// pragmas (deserialize resets foreign_keys and busy_timeout to 0) and the migration journal check. Tests of
// file databases, WAL, locks, migrations, legacy auth.json import, or workerd keep Database.layer / configuredClient.

const emptyGlobal = Layer.succeed(Global.Service, Global.make())
const compiler = Statement.makeCompilerSqlite()

// Built once per test process with an isolated empty Global so caller auth.json files can never leak into the template.
const template = Effect.runSync(
  Effect.cached(
    Effect.scoped(
      Effect.gen(function* () {
        const database = new Sqlite(":memory:")
        const clientLayer = Layer.effect(SqlClient.SqlClient, make(database)).pipe(Layer.provide(Reactivity.layer))
        yield* Layer.build(Database.layerFromClient.pipe(Layer.provide([clientLayer, emptyGlobal])))
        return database.serialize()
      }),
    ),
  ),
)

/** A closed SqlClient over a private copy of the migrated template. */
export const client: Layer.Layer<SqlClient.SqlClient> = Layer.effect(
  SqlClient.SqlClient,
  Effect.flatMap(template, (bytes) => make(Sqlite.deserialize(bytes))),
).pipe(Layer.provide(Reactivity.layer))

/** A closed Database.Service over a private copy of the migrated template with production pragmas applied. */
export const layer: Layer.Layer<Database.Service> = Database.layerFromClient.pipe(Layer.provide([client, emptyGlobal]))

/** Use the template copy wherever a graph asks for Database.node. */
export const replacement = Database.node.replace(layer)

// The SqliteClient from @effect/sql-sqlite-bun only opens filenames, so this is its client over a Database we
// already hold: one connection, serialized through makeSqliteAcquirers, with BEGIN IMMEDIATE transactions.
function make(database: Sqlite) {
  return Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => database.close()))
    const prepare = (sql: string, safe: boolean) =>
      database.query<Record<string, unknown>, SQLQueryBindings[]>(sql).safeIntegers(safe)
    const run = <A>(operation: string, f: (safe: boolean) => A) =>
      Effect.withFiber((fiber) =>
        Effect.try({
          try: () => f(Context.get(fiber.context, SqlClient.SafeIntegers)),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation }),
            }),
        }),
      )
    const all = (sql: string, params: ReadonlyArray<unknown>) =>
      run("execute", (safe) => prepare(sql, safe).all(...(params as SQLQueryBindings[])))
    const values = (sql: string, params: ReadonlyArray<unknown>) =>
      run("executeValues", (safe) => prepare(sql, safe).values(...(params as SQLQueryBindings[])))
    const connection: SqlConnection.Connection = {
      execute: (sql, params, transformRows) =>
        transformRows ? Effect.map(all(sql, params), transformRows) : all(sql, params),
      executeRaw: all,
      executeValues: values,
      executeValuesUnprepared: values,
      executeUnprepared: (sql, params, transformRows) => connection.execute(sql, params, transformRows),
      executeStream: () => Stream.die("executeStream not implemented"),
    }
    const acquirers = SqlClient.makeSqliteAcquirers({
      connection: Effect.succeed(connection),
      semaphore: yield* Semaphore.make(1),
      isTransaction: () => database.inTransaction,
    })
    return yield* SqlClient.make({
      ...acquirers,
      driver: "sqlite-bun",
      compiler,
      releaseSavepoint: (name) => `RELEASE SAVEPOINT ${name}`,
      beginTransaction: "BEGIN IMMEDIATE",
      spanAttributes: [["db.system.name", "sqlite"]],
    })
  })
}
