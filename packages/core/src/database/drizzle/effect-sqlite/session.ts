/* oxlint-disable */
import { Effect } from "effect"
import { BeginTransaction, type SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import type { EffectCacheShape } from "drizzle-orm/cache/core/cache-effect"
import type { WithCacheConfig } from "drizzle-orm/cache/core/types"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import type { EffectLoggerShape } from "drizzle-orm/effect-core/logger"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations } from "drizzle-orm/relations"
import type { RelationalQueryMapperConfig } from "drizzle-orm/relations"
import type { Query } from "drizzle-orm/sql/sql"
import type { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import {
  SQLiteEffectPreparedQuery,
  SQLiteEffectSession,
  SQLiteEffectTransaction,
} from "../sqlite-core/effect/session.js"
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types"
import type { PreparedQueryConfig, SQLiteExecuteMethod, SQLiteTransactionConfig } from "drizzle-orm/sqlite-core/session"

export interface EffectSQLiteQueryEffectHKT extends QueryEffectHKTBase {
  readonly error: EffectDrizzleQueryError
  readonly context: never
}

/**
 * A SqlClient whose runtime rejects SQL transaction statements (BEGIN/COMMIT/SAVEPOINT) and
 * manages transactions natively instead — Cloudflare Durable Object SQLite. Producers set
 * `transactionStatements: false` (see `database/sqlite.workerd.ts`) so callers skip SQLite
 * pragmas and `BeginTransaction` overrides.
 */
export interface NativeTransactionSqlClient extends SqlClient {
  readonly transactionStatements: false
}

export function managesTransactionsNatively(client: SqlClient): client is NativeTransactionSqlClient {
  return (client as SqlClient & { readonly transactionStatements?: boolean }).transactionStatements === false
}

export type EffectSQLiteRunResult = readonly never[]

export interface EffectSQLiteSessionOptions {
  logger: EffectLoggerShape
  cache: EffectCacheShape
  useJitMappers?: boolean
}

export class EffectSQLiteSession<TRelations extends AnyRelations> extends SQLiteEffectSession<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteSession"

  constructor(
    private client: SqlClient,
    dialect: SQLiteDialect,
    protected relations: TRelations,
    private options: EffectSQLiteSessionOptions,
  ) {
    super(dialect)
  }

  override prepareQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    customResultMapper?: (rows: unknown[][], mapColumnValue?: (value: unknown) => unknown) => unknown,
    queryMetadata?: {
      type: "select" | "update" | "delete" | "insert"
      tables: string[]
    },
    cacheConfig?: WithCacheConfig,
  ): SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT> {
    return new SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT>(
      (params, method) => this.execute(query, params, method),
      query,
      this.options.logger,
      this.options.cache,
      queryMetadata,
      cacheConfig,
      fields,
      executeMethod,
      this.options.useJitMappers,
      customResultMapper,
      undefined,
      undefined,
      this.isInTransaction(),
    )
  }

  override prepareRelationalQuery<T extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query,
    fields: SelectedFieldsOrdered | undefined,
    executeMethod: SQLiteExecuteMethod,
    customResultMapper: (rows: Record<string, unknown>[], mapColumnValue?: (value: unknown) => unknown) => unknown,
    config: RelationalQueryMapperConfig,
  ): SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT, true> {
    return new SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT, true>(
      (params, method) => this.execute(query, params, method),
      query,
      this.options.logger,
      this.options.cache,
      undefined,
      undefined,
      fields,
      executeMethod,
      this.options.useJitMappers,
      customResultMapper,
      true,
      config,
      this.isInTransaction(),
    )
  }

  private execute(query: Query, params: unknown[], method: SQLiteExecuteMethod | "values") {
    const statement = this.client.unsafe(query.sql, params)
    if (method === "values") return statement.values.pipe(Effect.withTracerEnabled(false))
    if (method === "get")
      return statement.withoutTransform.pipe(
        Effect.map((rows) => rows[0]),
        Effect.withTracerEnabled(false),
      )
    return statement.withoutTransform.pipe(Effect.withTracerEnabled(false))
  }

  private isInTransaction() {
    return Effect.serviceOption(this.client.transactionService).pipe(Effect.map((option) => option._tag === "Some"))
  }

  // The client's own withTransaction serializes sibling savepoints on the transaction's connection, waits for that
  // connection interruptibly, and skips a rollback once SQLite has already rolled the transaction back itself. Its
  // default BEGIN is the client's: BEGIN IMMEDIATE, so a writer never fails with SQLITE_BUSY_SNAPSHOT on upgrade.
  override transaction<A, E, R>(
    transaction: (tx: EffectSQLiteTransaction<TRelations>) => Effect.Effect<A, E, R>,
    config?: SQLiteTransactionConfig,
  ): Effect.Effect<A, E | SqlError, R> {
    const body = Effect.suspend(() => transaction(new EffectSQLiteTransaction(this.dialect, this, this.relations)))
    if (config?.behavior === undefined || managesTransactionsNatively(this.client)) {
      return this.client.withTransaction(body)
    }
    return this.client
      .withTransaction(Effect.provideService(body, BeginTransaction, undefined))
      .pipe(Effect.provideService(BeginTransaction, `BEGIN ${config.behavior.toUpperCase()}`))
  }
}

export class EffectSQLiteTransaction<TRelations extends AnyRelations> extends SQLiteEffectTransaction<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteTransaction"
}
