import { SqliteClient } from "@effect/sql-sqlite-node"
import { Effect, Exit, Layer, Option, Schema, Scope } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import { bootLockRetrySchedule, isTransientSqliteLockError } from "./boot-lock.js"

export const supportsTuningPragmas = true

// Foreign keys default ON in node:sqlite and can be toggled per connection.
export const supportsForeignKeyToggle = true

// Retry transient SQLite lock errors asynchronously (closing each failed handle
// before sleeping) so a replacing service waits out a predecessor's WAL release
// without freezing the event loop; permanent failures remain fatal.
export const sqliteLayer = (config: SqliteClient.SqliteClientConfig): Layer.Layer<SqlClient.SqlClient> =>
  Layer.effect(
    SqlClient.SqlClient,
    Effect.gen(function* () {
      const parentScope = yield* Scope.Scope
      return yield* Effect.gen(function* () {
        const attemptScope = yield* Scope.fork(parentScope)
        return yield* SqliteClient.make(config).pipe(
          Effect.provideService(Scope.Scope, attemptScope),
          Effect.onError((cause) => Scope.close(attemptScope, Exit.failCause(cause))),
        )
      }).pipe(
        Effect.tapError((error) =>
          isTransientSqliteLockError(error)
            ? Effect.logWarning("sqlite open hit transient lock; retrying", { filename: config.filename, error })
            : Effect.void,
        ),
        Effect.retry({
          while: isTransientSqliteLockError,
          schedule: bootLockRetrySchedule,
        }),
        Effect.orDie,
      )
    }),
  ).pipe(Layer.provide(Reactivity.layer))

// node:sqlite has no error class: SQLite failures are an Error marked ERR_SQLITE_ERROR that carries SQLite's extended
// result code in errcode.
const decodeDriverError = Schema.decodeUnknownOption(
  Schema.Struct({ code: Schema.Literal("ERR_SQLITE_ERROR"), errcode: Schema.Number }),
)

export const resultCode = (cause: unknown) =>
  decodeDriverError(cause).pipe(
    Option.map((error) => error.errcode),
    Option.getOrUndefined,
  )
