import { Context, Effect, Exit, Fiber, Layer, Scope, Semaphore, Stream } from "effect"
import { identity } from "effect/Function"
import { Reactivity } from "effect/unstable/reactivity"
import { SqlClient, Statement } from "effect/unstable/sql"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError, UnknownError } from "effect/unstable/sql/SqlError"
import type { NativeTransactionSqlClient } from "./drizzle/effect-sqlite/session.js"
import { Sqlite } from "./sqlite.js"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

const TypeId = "~@opencode-ai/core/database/SqliteWorkerd" as const
type TypeId = typeof TypeId

// Durable Object SQLite only allowlists introspection pragmas; journal_mode,
// synchronous, busy_timeout, cache_size, and wal_checkpoint all throw, and
// foreign keys are already enforced by default (SQLITE_DEFAULT_FOREIGN_KEYS=1).
export const supportsTuningPragmas = false

// Durable Object SQLite rejects `PRAGMA foreign_keys`: enforcement is always
// on (SQLITE_DEFAULT_FOREIGN_KEYS=1) and only `defer_foreign_keys` is
// allowlisted for migrations that must relax checking inside a transaction.
export const supportsForeignKeyToggle = false

// Minimal structural types for the Durable Object storage API so this adapter
// does not depend on @cloudflare/workers-types (whose ambient globals conflict
// with @types/bun). Shapes match the SqlStorage and DurableObjectStorage docs.
type SqlStorageValue = ArrayBuffer | string | number | null

interface SqlStorageCursor {
  readonly columnNames: Array<string>
  raw(): IterableIterator<Array<SqlStorageValue>>
  toArray(): Array<Record<string, SqlStorageValue>>
}

export interface SqlStorage {
  exec(query: string, ...bindings: Array<unknown>): SqlStorageCursor
}

export interface DurableObjectStorage {
  readonly sql: SqlStorage
  transaction<T>(closure: (txn: { rollback(): void }) => Promise<T>): Promise<T>
  transactionSync<T>(closure: () => T): T
}

interface SqliteClient extends SqlClient.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: Config
  readonly updateValues: never
}

interface Config {
  readonly storage: DurableObjectStorage
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

// sql.exec() rejects BEGIN/COMMIT/SAVEPOINT, so SqlClient.make's default
// transaction SQL can never run. withTransaction is replaced below with a
// DurableObjectStorage.transaction-backed implementation; this service only
// tracks the active transaction connection for statements and nesting checks.
const WorkerdTransaction = Context.Service<SqlClient.TransactionConnection, SqlClient.TransactionConnection.Service>(
  "@opencode-ai/core/database/SqliteWorkerdTransaction",
)

const transactionError = (message: string) =>
  new SqlError({
    reason: new UnknownError({ cause: new Error(message), message, operation: "transaction" }),
  })

const makeWithTransaction =
  (
    storage: DurableObjectStorage,
    connection: Connection,
    semaphore: Semaphore.Semaphore,
  ): SqlClient.SqlClient["withTransaction"] =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | SqlError, R> =>
    Effect.withFiber((fiber) => {
      const services = fiber.context
      if (Context.getOption(services, WorkerdTransaction)._tag === "Some")
        return Effect.fail(
          transactionError("Nested transactions are not supported by Cloudflare Durable Object SQLite storage"),
        )
      const effectWithTxn = Effect.provideContext(
        effect,
        Context.add(services, WorkerdTransaction, [connection, 0] as const),
      )
      return semaphore.withPermits(1)(
        Effect.callback((resume) => {
          let interrupted = false
          const promise = storage
            .transaction(
              (txn) =>
                new Promise<void>((resolve) => {
                  if (interrupted) return resolve()
                  resume(
                    Effect.onExit(effectWithTxn, (exit) => {
                      if (Exit.isFailure(exit)) txn.rollback()
                      resolve()
                      // wait for the transaction to complete
                      return Effect.promise(() => promise)
                    }),
                  )
                }),
            )
            .catch((cause) =>
              resume(
                Effect.fail(
                  new SqlError({
                    reason: classifySqliteError(cause, { message: "Failed transaction", operation: "transaction" }),
                  }),
                ),
              ),
            )
          return Effect.suspend(() => {
            interrupted = true
            return Effect.promise(() => promise)
          })
        }),
      )
    })

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as DurableObjectStorage

    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    // SqlClient.SafeIntegers is ignored: Durable Object SQLite has no bigint
    // mode and always returns integers as numbers. Blobs come back as
    // ArrayBuffer and are normalized to Uint8Array to match the other adapters.
    function* runIterator(query: string, params: ReadonlyArray<unknown> = []) {
      const cursor = native.sql.exec(query, ...params)
      const columns = cursor.columnNames
      for (const row of cursor.raw()) {
        const record: Record<string, unknown> = {}
        for (let i = 0; i < columns.length; i++) {
          const value = row[i]
          record[columns[i]] = value instanceof ArrayBuffer ? new Uint8Array(value) : value
        }
        yield record
      }
    }

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () => Array.from(runIterator(query, params)),
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
          }),
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () =>
          Array.from(native.sql.exec(query, ...params).raw(), (row) =>
            row.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)),
          ),
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
          }),
      })

    const connection = identity<Connection>({
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
    })

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

    const client = Object.assign(
      (yield* SqlClient.make({
        acquirer,
        compiler,
        transactionAcquirer,
        transactionService: WorkerdTransaction,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      })) as SqliteClient,
      {
        [TypeId]: TypeId,
        config: options,
        withTransaction: makeWithTransaction(native, connection, semaphore),
        // Durable Object SQLite rejects BEGIN/COMMIT/SAVEPOINT; consumers such
        // as the drizzle session detect this and route through withTransaction.
        transactionStatements: false,
      } as const,
    ) satisfies NativeTransactionSqlClient

    return client
  })

// Defends against the shared path-based Database.layer, which passes a
// filename instead of storage when resolved under the workerd condition.
const nativeLayer = (config: Config) =>
  config.storage
    ? Layer.succeed(Sqlite.Native, config.storage)
    : Layer.effect(
        Sqlite.Native,
        Effect.die(
          "workerd sqlite cannot open a database from a path; use Database.layerWith(sqliteLayer({ storage }))",
        ),
      )

const clientLayer = (config: Config) => Layer.effect(SqlClient.SqlClient, make(config))

export const sqliteLayer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, clientLayer(config).pipe(Layer.provide(native))).pipe(Layer.provide(Reactivity.layer))
}
