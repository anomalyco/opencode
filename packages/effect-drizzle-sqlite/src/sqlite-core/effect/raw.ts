/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import type { PreparedQuery } from "drizzle-orm/session"
import type { Query, SQL, SQLWrapper } from "drizzle-orm/sql/sql"
import type { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core/dialect"

type SQLiteEffectRawAction = "all" | "get" | "values" | "run"

export interface SQLiteEffectRaw<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  extends Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]>,
    RunnableQuery<TResult, "sqlite">,
    SQLWrapper {}

export class SQLiteEffectRaw<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  implements RunnableQuery<TResult, "sqlite">, SQLWrapper, PreparedQuery
{
  static readonly [entityKind]: string = "SQLiteEffectRaw"

  declare readonly _: {
    readonly dialect: "sqlite"
    readonly result: TResult
  }

  constructor(
    public execute: () => Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]>,
    /** @internal */
    public getSQL: () => SQL,
    private action: SQLiteEffectRawAction,
    private dialect: SQLiteAsyncDialect,
    private mapBatchResult: (result: unknown) => unknown,
  ) {}

  getQuery(): Query & { method: SQLiteEffectRawAction } {
    return { ...this.dialect.sqlToQuery(this.getSQL()), method: this.action }
  }

  mapResult(result: unknown, isFromBatch?: boolean) {
    return isFromBatch ? this.mapBatchResult(result) : result
  }

  _prepare(): PreparedQuery {
    return this
  }
}

applyEffectWrapper(SQLiteEffectRaw)
