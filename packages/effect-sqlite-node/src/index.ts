export * as NodeSqliteClient from "./index"

import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { identity } from "effect/Function"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Client from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import * as Statement from "effect/unstable/sql/Statement"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

export const TypeId: TypeId = "~@opencode-ai/effect-sqlite-node/NodeSqliteClient"
export type TypeId = "~@opencode-ai/effect-sqlite-node/NodeSqliteClient"

export interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: SqliteClientConfig
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
  readonly updateValues: never
}

export const SqliteClient = Context.Service<SqliteClient>("@opencode-ai/effect-sqlite-node/NodeSqliteClient")

export interface SqliteClientConfig {
  readonly filename: string
  readonly readonly?: boolean | undefined
  readonly create?: boolean | undefined
  readonly readwrite?: boolean | undefined
  readonly disableWAL?: boolean | undefined
  readonly timeout?: number | undefined
  readonly allowExtension?: boolean | undefined
  readonly spanAttributes?: Record<string, unknown> | undefined
  readonly transformResultNames?: ((str: string) => string) | undefined
  readonly transformQueryNames?: ((str: string) => string) | undefined
}

interface SqliteConnection extends Connection {
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
}

export const make = (
  options: SqliteClientConfig,
): Effect.Effect<SqliteClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    const makeConnection = Effect.gen(function* () {
      const db = new DatabaseSync(options.filename, {
        readOnly: options.readonly,
        timeout: options.timeout,
        allowExtension: options.allowExtension,
        enableForeignKeyConstraints: true,
        open: true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => db.close()))

      if (options.disableWAL !== true && options.readonly !== true) {
        db.exec("PRAGMA journal_mode = WAL;")
      }

      const run = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
          const statement = db.prepare(sql)
          statement.setReadBigInts(Context.get(fiber.context, Client.SafeIntegers))
          try {
            return Effect.succeed(statement.all(...(params as SQLInputValue[])) as Array<Record<string, unknown>>)
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
              }),
            )
          }
        })

      const runValues = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
          const statement = db.prepare(sql)
          statement.setReadBigInts(Context.get(fiber.context, Client.SafeIntegers))
          statement.setReturnArrays(true)
          try {
            return Effect.succeed(
              statement.all(...(params as SQLInputValue[])) as unknown as ReadonlyArray<ReadonlyArray<unknown>>,
            )
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
              }),
            )
          }
        })

      return identity<SqliteConnection>({
        execute(sql, params, transformRows) {
          return transformRows ? Effect.map(run(sql, params), transformRows) : run(sql, params)
        },
        executeRaw(sql, params) {
          return run(sql, params)
        },
        executeValues(sql, params) {
          return runValues(sql, params)
        },
        executeUnprepared(sql, params, transformRows) {
          return this.execute(sql, params, transformRows)
        },
        executeStream() {
          return Stream.die("executeStream not implemented")
        },
        loadExtension: (path) =>
          Effect.try({
            try: () => db.loadExtension(path),
            catch: (cause) =>
              new SqlError({
                reason: classifySqliteError(cause, { message: "Failed to load extension", operation: "loadExtension" }),
              }),
          }),
      })
    })

    const semaphore = yield* Semaphore.make(1)
    const connection = yield* makeConnection
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        connection,
      )
    })

    return Object.assign(
      (yield* Client.make({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      })) as SqliteClient,
      {
        [TypeId]: TypeId as TypeId,
        config: options,
        loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
      },
    )
  })

export const layer = (config: SqliteClientConfig): Layer.Layer<SqliteClient | Client.SqlClient> =>
  Layer.effectContext(
    Effect.map(make(config), (client) =>
      Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer))
