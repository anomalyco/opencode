/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import { SQL, sql, type SQLWrapper } from "drizzle-orm/sql/sql"
import type { SQLiteTable } from "drizzle-orm/sqlite-core/table"
import type { SQLiteView } from "drizzle-orm/sqlite-core/view"
import type { SQLiteEffectSession } from "./session"

function buildSQLiteEmbeddedCount(source: SQLiteTable | SQLiteView | SQL | SQLWrapper, filters?: SQL<unknown>) {
  return sql<number>`(select count(*) from ${source}${sql.raw(" where ").if(filters)}${filters})`
}

function buildSQLiteCount(source: SQLiteTable | SQLiteView | SQL | SQLWrapper, filters?: SQL<unknown>) {
  return sql<number>`select count(*) from ${source}${sql.raw(" where ").if(filters)}${filters}`
}

export interface SQLiteEffectCountBuilder<TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  extends SQL<number>,
    SQLWrapper<number>,
    Effect.Effect<number, TEffectHKT["error"], TEffectHKT["context"]> {}

export class SQLiteEffectCountBuilder<TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase> extends SQL<number> {
  static override readonly [entityKind]: string = "SQLiteEffectCountBuilder"

  private sql: SQL<number>
  private session: SQLiteEffectSession<TEffectHKT, any, any>

  constructor(params: {
    source: SQLiteTable | SQLiteView | SQL | SQLWrapper
    filters?: SQL<unknown>
    session: SQLiteEffectSession<TEffectHKT, any, any>
  }) {
    super(buildSQLiteEmbeddedCount(params.source, params.filters).queryChunks)

    this.session = params.session
    this.sql = buildSQLiteCount(params.source, params.filters)
  }

  execute(placeholderValues?: Record<string, unknown>) {
    return this.session
      .prepareQuery<{
        type: "async"
        execute: number
        run: unknown
        all: unknown
        get: unknown
        values: unknown
      }>(this.session.dialect.sqlToQuery(this.sql), undefined, "all", (rows) => {
        const v = rows[0]?.[0]
        if (typeof v === "number") return v
        return v ? Number(v) : 0
      })
      .execute(placeholderValues)
  }
}

applyEffectWrapper(SQLiteEffectCountBuilder)
