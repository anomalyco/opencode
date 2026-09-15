/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind } from "drizzle-orm/entity"
import {
  type BuildQueryResult,
  type BuildRelationalQueryResult,
  type DBQueryConfig,
  makeDefaultRqbMapper,
  type TableRelationalConfig,
  type TablesRelationalConfig,
} from "drizzle-orm/relations"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import { type Query, type SQL, sql, type SQLWrapper } from "drizzle-orm/sql/sql"
import type { KnownKeysOnly } from "drizzle-orm/utils"
import type { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import type { PreparedQueryConfig } from "drizzle-orm/sqlite-core/session"
import type { SQLiteTable } from "drizzle-orm/sqlite-core/table"
import type { SQLiteEffectPreparedQuery, SQLiteEffectSession } from "./session"

export class SQLiteEffectRelationalQueryBuilder<
  TSchema extends TablesRelationalConfig,
  TFields extends TableRelationalConfig,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> {
  static readonly [entityKind]: string = "SQLiteEffectRelationalQueryBuilderV2"

  constructor(
    private schema: TSchema,
    private table: SQLiteTable,
    private tableConfig: TableRelationalConfig,
    private dialect: SQLiteDialect,
    private session: SQLiteEffectSession<TEffectHKT, any, any>,
    private rowMode?: boolean,
    private forbidJsonb?: boolean,
  ) {}

  findMany<TConfig extends DBQueryConfig<"many", TSchema, TFields>>(
    config?: KnownKeysOnly<TConfig, DBQueryConfig<"many", TSchema, TFields>>,
  ): SQLiteEffectRelationalQuery<BuildQueryResult<TSchema, TFields, TConfig>[], TEffectHKT> {
    return new SQLiteEffectRelationalQuery(
      this.schema,
      this.table,
      this.tableConfig,
      this.dialect,
      this.session,
      (config as DBQueryConfig<"many"> | undefined) ?? true,
      "many",
      this.rowMode,
      this.forbidJsonb,
    )
  }

  findFirst<TConfig extends DBQueryConfig<"one", TSchema, TFields>>(
    config?: KnownKeysOnly<TConfig, DBQueryConfig<"one", TSchema, TFields>>,
  ): SQLiteEffectRelationalQuery<BuildQueryResult<TSchema, TFields, TConfig> | undefined, TEffectHKT> {
    return new SQLiteEffectRelationalQuery(
      this.schema,
      this.table,
      this.tableConfig,
      this.dialect,
      this.session,
      (config as DBQueryConfig<"one"> | undefined) ?? true,
      "first",
      this.rowMode,
      this.forbidJsonb,
    )
  }
}

export interface SQLiteEffectRelationalQuery<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  extends Effect.Effect<TResult, TEffectHKT["error"], TEffectHKT["context"]>,
    RunnableQuery<TResult, "sqlite">,
    SQLWrapper {}

export class SQLiteEffectRelationalQuery<TResult, TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase>
  implements RunnableQuery<TResult, "sqlite">, SQLWrapper
{
  static readonly [entityKind]: string = "SQLiteEffectRelationalQueryV2"

  declare readonly _: {
    readonly dialect: "sqlite"
    readonly type: "async"
    readonly result: TResult
  }

  /** @internal */
  mode: "many" | "first"
  /** @internal */
  table: SQLiteTable

  constructor(
    private schema: TablesRelationalConfig,
    table: SQLiteTable,
    private tableConfig: TableRelationalConfig,
    private dialect: SQLiteDialect,
    private session: SQLiteEffectSession<TEffectHKT, any, any>,
    private config: DBQueryConfig<"many" | "one"> | true,
    mode: "many" | "first",
    private rowMode?: boolean,
    private forbidJsonb?: boolean,
  ) {
    this.mode = mode
    this.table = table
  }

  /** @internal */
  getSQL(): SQL {
    return this._getQuery().sql
  }

  /** @internal */
  _prepare(
    isOneTimeQuery = true,
  ): SQLiteEffectPreparedQuery<
    PreparedQueryConfig & { all: TResult; get: TResult; execute: TResult },
    TEffectHKT,
    true
  > {
    const { query, builtQuery } = this._toSQL()
    const mapperConfig = {
      isFirst: this.mode === "first",
      parseJson: !this.rowMode,
      parseJsonIfString: false,
      rootJsonMappers: true,
      selection: query.selection,
    }

    return this.session[isOneTimeQuery ? "prepareOneTimeRelationalQuery" : "prepareRelationalQuery"](
      builtQuery,
      undefined,
      this.mode === "first" ? "get" : "all",
      makeDefaultRqbMapper(mapperConfig),
      mapperConfig,
    ) as SQLiteEffectPreparedQuery<
      PreparedQueryConfig & { all: TResult; get: TResult; execute: TResult },
      TEffectHKT,
      true
    >
  }

  prepare(): SQLiteEffectPreparedQuery<
    PreparedQueryConfig & { all: TResult; get: TResult; execute: TResult },
    TEffectHKT,
    true
  > {
    return this._prepare(false)
  }

  private _getQuery() {
    const jsonb = this.forbidJsonb ? sql`json` : sql`jsonb`

    const query = this.dialect.buildRelationalQuery({
      schema: this.schema,
      table: this.table,
      tableConfig: this.tableConfig,
      queryConfig: this.config,
      mode: this.mode,
      isNested: this.rowMode,
      jsonb,
    })

    if (this.rowMode) {
      const jsonColumns = sql.join(
        query.selection.map((s) => {
          return sql`${sql.raw(this.dialect.escapeString(s.key))}, ${
            s.selection ? sql`${jsonb}(${sql.identifier(s.key)})` : sql.identifier(s.key)
          }`
        }),
        sql`, `,
      )

      query.sql = sql`select json_object(${jsonColumns}) as ${sql.identifier("r")} from (${query.sql}) as ${sql.identifier(
        "t",
      )}`
    }

    return query
  }

  private _toSQL(): { query: BuildRelationalQueryResult; builtQuery: Query } {
    const query = this._getQuery()

    const builtQuery = this.dialect.sqlToQuery(query.sql)

    return { query, builtQuery }
  }

  toSQL(): Query {
    return this._toSQL().builtQuery
  }

  execute(placeholderValues?: Record<string, unknown>) {
    return this.mode === "first" ? this._prepare().get(placeholderValues) : this._prepare().all(placeholderValues)
  }
}

applyEffectWrapper(SQLiteEffectRelationalQuery)
