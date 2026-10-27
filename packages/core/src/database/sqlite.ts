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
// would only burn the budget. Rolling back and rerunning the whole
// transaction is the only recovery there, and only the caller can do it: the
// body reads and branches between its statements, so whether a rerun is safe
// is the caller's call. The durable write paths (Bus, session lifecycle) get
// that caller-side replay from #53704's StorageRetry; this client stays at
// statement scope so the two layers never retry the same write — a
// transaction's body statements never retry here, and its BEGIN, COMMIT and
// ROLLBACK retry in place while it holds the semaphore, so a caller-side
// replay only starts after this client's budget is spent.
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

// One key per client, so a gate never mistakes another client's transaction for its own.
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
    // Body statements of our own transaction carry its service and run while
    // the transaction holds the semaphore, so both gates pass them through
    // untouched — a BUSY_SNAPSHOT there repeats until rollback and retrying
    // would only burn budget (see the block comment above).
    const gateStatement = <A>(attempt: Effect.Effect<A, SqlError>): Effect.Effect<A, SqlError> =>
      Effect.withFiber((fiber) => {
        if (Context.getOption(fiber.context, transactionService)._tag === "Some") return attempt
        // The permit covers the attempt, not just handing out the connection:
        // effect-sql runs the statement after its acquirer has already
        // returned, so a permit dropped there would let a transaction opened
        // in that gap swallow the attempt. A transaction holds the semaphore
        // for its whole life, so this take waits out any that opened while a
        // previous attempt slept.
        return retryLockTimeout(semaphore.withPermits(1)(attempt))
      })
    // Service-less statements on the transaction connection are exactly its
    // BEGIN, COMMIT and ROLLBACK: effect-sql runs BEGIN after the acquirer
    // returns and COMMIT/ROLLBACK after the body's service is withdrawn, all
    // before the transaction's scope releases the semaphore (nested
    // savepoints run inside the body, so they arrive above with the service).
    // The transaction already holds the semaphore, so re-taking it would
    // deadlock; they retry in place.
    const gateTransactionStatement = <A>(attempt: Effect.Effect<A, SqlError>): Effect.Effect<A, SqlError> =>
      Effect.withFiber((fiber) => {
        if (Context.getOption(fiber.context, transactionService)._tag === "Some") return attempt
        return retryLockTimeout(attempt)
      })
    const gateConnection = (
      gate: <A>(attempt: Effect.Effect<A, SqlError>) => Effect.Effect<A, SqlError>,
    ): SqliteConnection => ({
      ...connection,
      execute: (query, params, transformRows) => gate(connection.execute(query, params, transformRows)),
      executeRaw: (query, params) => gate(connection.executeRaw(query, params)),
      executeValues: (query, params) => gate(connection.executeValues(query, params)),
      executeUnprepared: (query, params, transformRows) =>
        gate(connection.executeUnprepared(query, params, transformRows)),
    })
    const acquirer = semaphore.withPermits(1)(Effect.succeed(gateConnection(gateStatement)))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        gateConnection(gateTransactionStatement),
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
