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
// Only autocommit statements are retried. Inside a transaction the same error
// repeats until the transaction is rolled back and restarted (SQLITE_BUSY_SNAPSHOT
// on a deferred transaction whose read snapshot went stale), so it surfaces at once.
//
// The budget and backoff curve are the policy in one place:
//   50ms doubling to 250ms, jittered, giving up after LOCK_BUDGET_MS total.
// Note the sleep runs inside the statement's connection lease (SqlClient
// acquires the single connection for the whole attempt), so a contended
// write back-pressures other statements on the same client for the duration;
// the budget bounds that hold per statement, and a caller with N serial
// statements can spend N times it before surfacing.
const LOCK_RETRY_INITIAL_MS = 50
const LOCK_RETRY_FACTOR = 2
const LOCK_RETRY_MAX_MS = 250
const LOCK_RETRY_BUDGET_MS = 30_000

export const retryLocked =
  (inTransaction: () => boolean) =>
  <A, E>(effect: Effect.Effect<A, E, never>) =>
    effect.pipe(
      Effect.retry({
        while: (error) => isSqlError(error) && error.reason._tag === "LockTimeoutError" && !inTransaction(),
        schedule: Schedule.min([
          Schedule.exponential(LOCK_RETRY_INITIAL_MS, LOCK_RETRY_FACTOR),
          Schedule.spaced(LOCK_RETRY_MAX_MS),
        ])
          .pipe(Schedule.jittered)
          .pipe(Schedule.upTo(LOCK_RETRY_BUDGET_MS)),
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
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        connection,
      )
    })
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    return Object.assign(
      yield* SqlClient.make({
        acquirer,
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
