export * as Sqlite from "./sqlite.js"

import { Context, Effect, Fiber, Schedule, Scope, Semaphore, Stream } from "effect"
import { identity } from "effect/Function"
import { SqlClient, Statement } from "effect/sql"
import type { Connection } from "effect/sql/SqlConnection"
import { isSqlError, type SqlError } from "effect/sql/SqlError"

export class Native extends Context.Service<Native, unknown>()("@opencode/core/database/SqliteNative") {}

export interface ClientConfig {
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

type Run = (
  query: string,
  params?: ReadonlyArray<unknown>,
) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, SqlError>

type RunValues = (
  query: string,
  params?: ReadonlyArray<unknown>,
) => Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>

// SQLITE_BUSY means another process held the write lock past busy_timeout. The
// statement itself is fine — retrying with an async sleep lets the competing
// process finish so the next attempt can acquire the lock. Without this, one
// long write in a concurrent process kills another process's prompt.
//
// The sleep runs between attempts, and while it sleeps another fiber can open
// a transaction on the shared connection; an attempt that only repeated the
// statement would then resume inside that foreign transaction, because the
// connection's own in-transaction flag cannot tell whose transaction it is
// reading. Each plain attempt therefore re-enters the client semaphore before
// executing: an open transaction holds the semaphore for its whole life, so
// the next attempt waits it out. Statements of our own transaction carry its
// service in the fiber context and fail fast instead — a BUSY_SNAPSHOT there
// repeats until the transaction is rolled back and restarted, so retrying
// would only burn the budget. BEGIN, COMMIT and ROLLBACK run outside that
// context while our transaction holds the semaphore, so they retry in place
// rather than re-take it.
//
// The budget and backoff curve are the policy in one place:
//   50ms doubling to 250ms, jittered, giving up after LOCK_BUDGET_MS total.
// The budget bounds how long one statement holds up the client; a caller with
// N serial statements can spend N times it before surfacing.
const LOCK_RETRY_INITIAL_MS = 50
const LOCK_RETRY_FACTOR = 2
const LOCK_RETRY_MAX_MS = 250
const LOCK_RETRY_BUDGET_MS = 30_000

const lockRetrySchedule = Schedule.min([
  Schedule.exponential(LOCK_RETRY_INITIAL_MS, LOCK_RETRY_FACTOR),
  Schedule.spaced(LOCK_RETRY_MAX_MS),
])
  .pipe(Schedule.jittered)
  .pipe(Schedule.upTo({ duration: LOCK_RETRY_BUDGET_MS }))

const retryLockTimeout = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.retry({
      while: (error) => isSqlError(error) && error.reason._tag === "LockTimeoutError",
      schedule: lockRetrySchedule,
    }),
  )

export const makeConnection = <Extensions extends object>(run: Run, runValues: RunValues, extensions: Extensions) =>
  identity<Connection & Extensions>({
    execute(query, params, transformRows) {
      return transformRows ? Effect.map(run(query, params), transformRows) : run(query, params)
    },
    executeRaw(query, params) {
      return run(query, params)
    },
    executeValues(query, params) {
      return runValues(query, params)
    },
    executeValuesUnprepared(query, params) {
      return runValues(query, params)
    },
    executeUnprepared(query, params, transformRows) {
      return this.execute(query, params, transformRows)
    },
    executeStream() {
      return Stream.die("executeStream not implemented")
    },
    ...extensions,
  })

// One key per client, so the gate only ever reads this client's transaction marker.
let transactionCounter = 0

export const makeClient = <
  Config extends ClientConfig,
  SqliteConnection extends Connection,
  const TypeId extends string,
  Extensions extends object,
>(
  options: Config,
  connection: SqliteConnection,
  typeId: TypeId,
  extensions: (acquirer: Effect.Effect<SqliteConnection, SqlError, Scope.Scope>) => Extensions,
) =>
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1)
    const transactionService = Context.Service<
      SqlClient.TransactionConnection,
      SqlClient.TransactionConnection.Service
    >(`@opencode/core/database/SqliteTransaction/${transactionCounter++}`)
    let transactionOpen = false
    const gateStatement = <A>(attempt: Effect.Effect<A, SqlError>): Effect.Effect<A, SqlError> =>
      Effect.withFiber((fiber) => {
        if (Context.getOption(fiber.context, transactionService)._tag === "Some") return attempt
        // BEGIN/COMMIT/ROLLBACK run outside the transaction's service context
        // while it holds the semaphore; re-taking it there would deadlock.
        if (transactionOpen) return retryLockTimeout(attempt)
        return retryLockTimeout(Effect.andThen(acquirer, attempt))
      })
    const gatedConnection: SqliteConnection = {
      ...connection,
      execute: (query, params, transformRows) => gateStatement(connection.execute(query, params, transformRows)),
      executeRaw: (query, params) => gateStatement(connection.executeRaw(query, params)),
      executeValues: (query, params) => gateStatement(connection.executeValues(query, params)),
      executeUnprepared: (query, params, transformRows) =>
        gateStatement(connection.executeUnprepared(query, params, transformRows)),
    }
    const acquirer = semaphore.withPermits(1)(Effect.succeed(gatedConnection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => {
          transactionOpen = true
          // Flip before releasing so a plain statement racing the close is gated.
          return Scope.addFinalizer(
            scope,
            Effect.andThen(
              Effect.sync(() => {
                transactionOpen = false
              }),
              semaphore.release(1),
            ),
          )
        }),
        gatedConnection,
      )
    })
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    return Object.assign(
      yield* SqlClient.make({
        acquirer,
        transactionService,
        compiler: Statement.makeCompilerSqlite(options.transformQueryNames),
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          ["db.system.name", "sqlite"],
        ],
        transformRows,
      }),
      {
        [typeId]: typeId,
        config: options,
        ...extensions(acquirer),
      },
    ) as SqlClient.SqlClient &
      Record<TypeId, TypeId> & {
        readonly config: Config
        readonly updateValues: never
      } & Extensions
  })
