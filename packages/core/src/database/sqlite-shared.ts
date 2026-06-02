import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { identity } from "effect/Function"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Client from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { SqlError } from "effect/unstable/sql/SqlError"
import * as Statement from "effect/unstable/sql/Statement"

export const ATTR_DB_SYSTEM_NAME = "db.system.name"

export interface Config {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  readonly timeout?: number
  readonly allowExtension?: boolean
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

export type RunFn = (
  query: string,
  params: ReadonlyArray<unknown>,
) => Effect.Effect<Array<Record<string, unknown>>, SqlError>

export type RunValuesFn = (
  query: string,
  params: ReadonlyArray<unknown>,
) => Effect.Effect<Array<unknown[]> | ReadonlyArray<ReadonlyArray<unknown>>, SqlError>

export function buildConnection<T extends Record<string, unknown>>(
  run: RunFn,
  runValues: RunValuesFn,
  overrides: T,
): Connection & T {
  return identity<Connection>({
    execute(query, params, transformRows) {
      return transformRows ? Effect.map(run(query, params), transformRows) : run(query, params)
    },
    executeRaw(query, params) {
      return run(query, params)
    },
    executeValues(query, params) {
      return runValues(query, params) as Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>
    },
    executeUnprepared(query, params, transformRows) {
      return this.execute(query, params, transformRows)
    },
    executeStream() {
      return Stream.die("executeStream not implemented")
    },
    ...overrides,
  }) as Connection & T
}

export function buildClient<T extends Record<string, unknown>, O extends Record<string, unknown>>(
  options: Config,
  connection: Connection & T,
  clientOverrides: (connection: Connection & T, acquirer: Effect.Effect<Connection & T>) => O,
) {
  return Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    const semaphore = yield* Semaphore.make(1)
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection)) as Effect.Effect<Connection & T>
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        connection,
      )
    })

    return Object.assign(
      yield* Client.make({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      }),
      clientOverrides(connection, acquirer),
    )
  })
}
