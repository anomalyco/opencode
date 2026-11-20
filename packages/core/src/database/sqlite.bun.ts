import { SQLiteError } from "bun:sqlite"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Exit, Layer, Scope } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import { bootLockRetrySchedule, isTransientSqliteLockError } from "./boot-lock.js"

export const supportsTuningPragmas = true

// Foreign keys default OFF and can be toggled per connection.
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

// bun:sqlite throws SQLiteError, whose errno is SQLite's extended result code.
export const resultCode = (cause: unknown) => (cause instanceof SQLiteError ? cause.errno : undefined)
