import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { identity } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Client from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import * as Statement from "effect/unstable/sql/Statement"
import { Sqlite } from "./sqlite"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

// Plain reads run on a second connection so they never queue behind the write semaphore.
const READS = /^\s*(?:select|explain)\b/i

const TypeId = "~@opencode-ai/core/database/SqliteNode" as const
type TypeId = typeof TypeId

// node:sqlite has no statement cache, so re-preparing on every call costs a
// parse+plan per query. Cache per connection, evicting least-recently-used.
const STATEMENT_CACHE_LIMIT = 256
const statementCacheByTarget = new WeakMap<object, Map<string, StatementSync>>()

function cachedStatement(target: DatabaseSync, mode: "all" | "values", query: string) {
  const cache = statementCacheByTarget.get(target) ?? new Map<string, StatementSync>()
  if (!statementCacheByTarget.has(target)) statementCacheByTarget.set(target, cache)
  const key = `${mode}:${query}`
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const statement = target.prepare(query)
  if (cache.size >= STATEMENT_CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  cache.set(key, statement)
  return statement
}

interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId
  readonly config: Config
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
  readonly updateValues: never
}

interface Config {
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

interface SqliteConnection extends Connection {
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
}

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as DatabaseSync

    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined

    const inMemory = options.filename.includes(":memory:") || options.filename.includes("mode=memory")
    const readNative =
      inMemory || options.disableWAL
        ? native
        : new DatabaseSync(options.filename, {
            readOnly: options.readonly,
            timeout: options.timeout,
            open: true,
          })
    if (readNative !== native) {
      yield* Effect.addFinalizer(() => Effect.sync(() => readNative.close()))
      readNative.exec("PRAGMA busy_timeout = 5000;")
      readNative.exec("PRAGMA cache_size = -32000;")
      readNative.exec("PRAGMA query_only = ON;")
    }

    const run = (target: DatabaseSync, query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        const statement = cachedStatement(target, "all", query)
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

    const runValues = (target: DatabaseSync, query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
        const statement = cachedStatement(target, "values", query)
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

    const writer = identity<SqliteConnection>({
      execute(query, params, transformRows) {
        return transformRows ? Effect.map(run(native, query, params), transformRows) : run(native, query, params)
      },
      executeRaw(query, params) {
        return run(native, query, params)
      },
      executeValues(query, params) {
        return runValues(native, query, params)
      },
      executeUnprepared(query, params, transformRows) {
        return this.execute(query, params, transformRows)
      },
      executeStream() {
        return Stream.die("executeStream not implemented")
      },
      loadExtension: (path) =>
        Effect.try({
          try: () => native.loadExtension(path),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to load extension", operation: "loadExtension" }),
            }),
        }),
    })

    const semaphore = yield* Semaphore.make(1)
    const gated = <A, E>(effect: Effect.Effect<A, E>) => semaphore.withPermits(1)(effect)

    const connection = identity<SqliteConnection>({
      execute(query, params, transformRows) {
        const result =
          READS.test(query) && readNative !== native
            ? run(readNative, query, params)
            : gated(run(native, query, params))
        return transformRows ? Effect.map(result, transformRows) : result
      },
      executeRaw(query, params) {
        return READS.test(query) && readNative !== native
          ? run(readNative, query, params)
          : gated(run(native, query, params))
      },
      executeValues(query, params) {
        return READS.test(query) && readNative !== native
          ? runValues(readNative, query, params)
          : gated(runValues(native, query, params))
      },
      executeUnprepared(query, params, transformRows) {
        return this.execute(query, params, transformRows)
      },
      executeStream() {
        return Stream.die("executeStream not implemented")
      },
      loadExtension: (path) => writer.loadExtension(path),
    })

    const acquirer = Effect.succeed(connection)
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!
      const scope = Context.getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        writer,
      )
    })

    const client = Object.assign(
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
        [TypeId]: TypeId,
        config: options,
        loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
      },
    )

    return client
  })

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const native = new DatabaseSync(config.filename, {
        readOnly: config.readonly,
        timeout: config.timeout,
        allowExtension: config.allowExtension,
        enableForeignKeyConstraints: true,
        open: true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      if (config.readonly !== true) native.exec("PRAGMA busy_timeout = 5000;")
      if (config.disableWAL !== true && config.readonly !== true) native.exec("PRAGMA journal_mode = WAL;")
      return native
    }),
  )

const sqliteLayer = (config: Config) => Layer.effect(Client.SqlClient, make(config))

const drizzleLayer = Layer.effect(
  Sqlite.Drizzle,
  Effect.gen(function* () {
    return drizzle({ client: (yield* Sqlite.Native) as DatabaseSync }) as unknown as Sqlite.DrizzleClient
  }),
)

export const layer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, Layer.merge(sqliteLayer(config), drizzleLayer).pipe(Layer.provide(native))).pipe(
    Layer.provide(Reactivity.layer),
  )
}
