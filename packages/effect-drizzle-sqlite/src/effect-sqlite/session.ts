/* oxlint-disable */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import type { EffectCacheShape } from "drizzle-orm/cache/core/cache-effect"
import type { WithCacheConfig } from "drizzle-orm/cache/core/types"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import type { EffectLoggerShape } from "drizzle-orm/effect-core/logger"
import type { QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { AnyRelations } from "drizzle-orm/relations"
import type { Query } from "drizzle-orm/sql/sql"
import type { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import { SQLiteEffectPreparedQuery, SQLiteEffectSession, SQLiteEffectTransaction } from "drizzle-orm/sqlite-core/effect/session"
import type { PreparedQueryConfig, SQLiteExecuteMethod, SQLiteTransactionConfig } from "drizzle-orm/sqlite-core/session"

export interface EffectSQLiteQueryEffectHKT extends QueryEffectHKTBase {
  readonly error: EffectDrizzleQueryError
  readonly context: never
}

export type EffectSQLiteRunResult = unknown

export interface EffectSQLiteSessionOptions {
  logger: EffectLoggerShape
  cache: EffectCacheShape
}

export class EffectSQLiteSession<TRelations extends AnyRelations> extends SQLiteEffectSession<
  EffectSQLiteRunResult,
  EffectSQLiteQueryEffectHKT,
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
    mode: "arrays" | "objects" | "raw",
    _prepare: boolean,
    executeMethod?: SQLiteExecuteMethod,
    mapper?: (rows: unknown[]) => unknown,
    queryMetadata?: {
      type: "select" | "update" | "delete" | "insert"
      tables: string[]
    },
    cacheConfig?: WithCacheConfig,
  ): SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT> {
    return new SQLiteEffectPreparedQuery<T, EffectSQLiteQueryEffectHKT>(
      executeMethod,
      {
        all: (params) => {
          const statement = this.client.unsafe(query.sql, params)
          if (mode === "arrays") return statement.values
          return statement.withoutTransform
        },
        get: (params) => {
          const statement = this.client.unsafe(query.sql, params)
          if (mode === "arrays") return statement.values.pipe(Effect.map((rows) => rows[0]))
          return statement.withoutTransform.pipe(Effect.map((rows) => rows[0]))
        },
        values: (params) => this.client.unsafe(query.sql, params).values,
        run: (params) => this.client.unsafe(query.sql, params).raw,
      },
      query,
      mapper,
      mode,
      this.options.logger,
      this.options.cache,
      queryMetadata,
      cacheConfig,
    )
  }

  private executeTransactionStatement(connection: Effect.Success<SqlClient["reserve"]>, query: string) {
    return connection.executeUnprepared(query, [], undefined).pipe(Effect.asVoid)
  }

  private withTransaction<A, E, R>(effect: Effect.Effect<A, E, R>, config: SQLiteTransactionConfig | undefined) {
    return Effect.uninterruptibleMask((restore) =>
      Effect.withFiber<A, E | SqlError, R>((fiber) => {
        const services = fiber.context
        const connectionOption = Context.getOption(services, this.client.transactionService)
        const connection: Effect.Effect<
          readonly [Scope.Closeable | undefined, Effect.Success<SqlClient["reserve"]>],
          SqlError
        > =
          connectionOption._tag === "Some"
            ? Effect.succeed([undefined, connectionOption.value[0]] as const)
            : Scope.make().pipe(
                Effect.flatMap((scope) =>
                  Scope.provide(this.client.reserve, scope).pipe(
                    Effect.map((connection) => [scope, connection] as const),
                    Effect.catch((error) =>
                      Scope.close(scope, Exit.fail(error)).pipe(Effect.andThen(Effect.fail(error))),
                    ),
                  ),
                ),
              )
        const id = connectionOption._tag === "Some" ? connectionOption.value[1] + 1 : 0

        return connection.pipe(
          Effect.flatMap(([scope, connection]) => {
            const transaction = this.executeTransactionStatement(
              connection,
              id === 0 ? `begin ${config?.behavior ?? "deferred"}` : `savepoint effect_sql_${id}`,
            ).pipe(
              Effect.flatMap(() =>
                Effect.provideContext(
                  restore(effect),
                  Context.add(services, this.client.transactionService, [connection, id]),
                ).pipe(
                  Effect.exit,
                  Effect.flatMap((exit) => {
                    const finalize = Exit.isSuccess(exit)
                      ? id === 0
                        ? this.executeTransactionStatement(connection, "commit").pipe(
                            // SQLite keeps the transaction open after deferred constraint commit failures.
                            Effect.catch((error) =>
                              this.executeTransactionStatement(connection, "rollback").pipe(
                                Effect.catch(() => Effect.void),
                                Effect.andThen(Effect.fail(error)),
                              ),
                            ),
                          )
                        : this.executeTransactionStatement(connection, `release savepoint effect_sql_${id}`)
                      : id === 0
                        ? this.executeTransactionStatement(connection, "rollback")
                        : this.executeTransactionStatement(connection, `rollback to savepoint effect_sql_${id}`).pipe(
                            Effect.andThen(
                              this.executeTransactionStatement(connection, `release savepoint effect_sql_${id}`),
                            ),
                          )

                    return finalize.pipe(Effect.flatMap(() => exit))
                  }),
                ),
              ),
            )

            return scope === undefined
              ? transaction
              : transaction.pipe(Effect.onExit((exit) => Scope.close(scope, exit)))
          }),
        )
      }),
    )
  }

  override transaction<A, E, R>(
    transaction: (tx: EffectSQLiteTransaction<TRelations>) => Effect.Effect<A, E, R>,
    config?: SQLiteTransactionConfig,
  ): Effect.Effect<A, E | SqlError, R> {
    const { dialect, relations } = this

    return this.withTransaction(
      Effect.gen({ self: this }, function* () {
        const tx = new EffectSQLiteTransaction<TRelations>(dialect, this, relations)

        return yield* transaction(tx)
      }),
      config,
    )
  }
}

export class EffectSQLiteTransaction<TRelations extends AnyRelations> extends SQLiteEffectTransaction<
  EffectSQLiteQueryEffectHKT,
  EffectSQLiteRunResult,
  TRelations
> {
  static override readonly [entityKind]: string = "EffectSQLiteTransaction"

  override transaction: <A, E, R>(
    transaction: (
      tx: SQLiteEffectTransaction<EffectSQLiteQueryEffectHKT, EffectSQLiteRunResult, TRelations>,
    ) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, SqlError | E, R> = (tx) => this._.session.transaction(tx)
}
