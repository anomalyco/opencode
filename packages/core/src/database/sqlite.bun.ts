import { Database, type SQLQueryBindings } from "bun:sqlite"
import { Context, Effect, Layer, Schedule } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import { classifySqliteError, SqlError } from "effect/sql/SqlError"
import { Sqlite } from "./sqlite.js"

const TypeId = "~@opencode/core/database/SqliteBun" as const

export const supportsTuningPragmas = true

// Foreign keys default OFF and can be toggled per connection.
export const supportsForeignKeyToggle = true

interface Config extends Sqlite.ClientConfig {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
}

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as Database

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        const statement = native.query<Record<string, unknown>, SQLQueryBindings[]>(query)
        // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
        statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
        try {
          return Effect.succeed(statement.all(...(params as SQLQueryBindings[])) ?? [])
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<unknown[]>, SqlError>((fiber) => {
        const statement = native.query<unknown, SQLQueryBindings[]>(query)
        // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
        statement.safeIntegers(Context.get(fiber.context, SqlClient.SafeIntegers))
        try {
          return Effect.succeed(statement.values(...(params as SQLQueryBindings[])) ?? [])
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const connection = Sqlite.makeConnection(run, runValues, {
      export: Effect.try({
        try: () => native.serialize(),
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to export database", operation: "export" }),
          }),
      }),
      loadExtension: (path: string) =>
        Effect.try({
          try: () => native.loadExtension(path),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to load extension", operation: "loadExtension" }),
            }),
        }),
    })

    return yield* Sqlite.makeClient(options, connection, TypeId, (acquirer) => ({
      export: Effect.flatMap(acquirer, (_) => _.export),
      loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
    }))
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const native = new Database(config.filename, {
        readonly: config.readonly,
        readwrite: config.readwrite ?? true,
        create: config.create ?? true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      if (config.disableWAL !== true) yield* switchToWAL(native)
      return native
    }),
  )

// Switching a fresh file to WAL takes an exclusive lock, and SQLite does not run the busy handler
// for a journal-mode change, so a second process opening the same new database at the same moment
// gets an immediate SQLITE_BUSY rather than waiting. Retry until the other connection finishes its
// switch; once the file is WAL the pragma reports that mode without taking the lock.
const switchToWAL = (native: Database) =>
  Effect.try({
    try: () => native.run("PRAGMA journal_mode = WAL;"),
    catch: (cause) => cause,
  }).pipe(
    Effect.retry({
      while: (cause) => cause instanceof Error && Sqlite.isBusy(cause),
      times: 50,
      schedule: Schedule.spaced("10 millis"),
    }),
    Effect.orDie,
  )

const clientLayer = (config: Config) => Layer.effect(SqlClient.SqlClient, make(config))

export const sqliteLayer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, clientLayer(config).pipe(Layer.provide(native))).pipe(Layer.provide(Reactivity.layer))
}
