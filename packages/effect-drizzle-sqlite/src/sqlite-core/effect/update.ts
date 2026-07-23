/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind, is } from "drizzle-orm/entity"
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import { SelectionProxyHandler } from "drizzle-orm/selection-proxy"
import type { Placeholder, Query, SQL, SQLWrapper } from "drizzle-orm/sql/sql"
import type { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import type { SelectedFields, SQLiteSelectJoinConfig } from "drizzle-orm/sqlite-core/query-builders/select.types"
import type { SQLiteUpdateConfig, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core/query-builders/update"
import type { PreparedQueryConfig } from "drizzle-orm/sqlite-core/session"
import { SQLiteTable } from "drizzle-orm/sqlite-core/table"
import { extractUsedTable } from "drizzle-orm/sqlite-core/utils"
import { SQLiteViewBase } from "drizzle-orm/sqlite-core/view-base"
import { Subquery } from "drizzle-orm/subquery"
import { type DrizzleTypeError, type UpdateSet, type ValueOrArray } from "drizzle-orm/utils"
import type { SQLiteColumn } from "drizzle-orm/sqlite-core/columns/common"
import {
  getTableColumnsRuntime,
  getTableLikeName,
  getViewSelectedFieldsRuntime,
  mapUpdateSet,
  orderSelectedFields,
} from "../../internal/drizzle-utils"
import type { SQLiteEffectPreparedQuery, SQLiteEffectSession } from "./session"

export type SQLiteEffectUpdateWithout<
  T extends AnySQLiteEffectUpdate,
  TDynamic extends boolean,
  K extends keyof T & string,
> = TDynamic extends true
  ? T
  : Omit<
      SQLiteEffectUpdateBase<
        T["_"]["table"],
        T["_"]["runResult"],
        T["_"]["from"],
        T["_"]["returning"],
        TDynamic,
        T["_"]["excludedMethods"] | K,
        T["_"]["effectHKT"]
      >,
      T["_"]["excludedMethods"] | K
    >

export type SQLiteEffectUpdateWithJoins<
  T extends AnySQLiteEffectUpdate,
  TDynamic extends boolean,
  TFrom extends SQLiteTable | Subquery | SQLiteViewBase | SQL,
> = TDynamic extends true
  ? T
  : Omit<
      SQLiteEffectUpdateBase<
        T["_"]["table"],
        T["_"]["runResult"],
        TFrom,
        T["_"]["returning"],
        TDynamic,
        Exclude<T["_"]["excludedMethods"] | "from", "leftJoin" | "rightJoin" | "innerJoin" | "fullJoin">,
        T["_"]["effectHKT"]
      >,
      Exclude<T["_"]["excludedMethods"] | "from", "leftJoin" | "rightJoin" | "innerJoin" | "fullJoin">
    >

export type SQLiteEffectUpdateReturningAll<
  T extends AnySQLiteEffectUpdate,
  TDynamic extends boolean,
> = SQLiteEffectUpdateWithout<
  SQLiteEffectUpdateBase<
    T["_"]["table"],
    T["_"]["runResult"],
    T["_"]["from"],
    T["_"]["table"]["$inferSelect"],
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type SQLiteEffectUpdateReturning<
  T extends AnySQLiteEffectUpdate,
  TDynamic extends boolean,
  TSelectedFields extends SelectedFields,
> = SQLiteEffectUpdateWithout<
  SQLiteEffectUpdateBase<
    T["_"]["table"],
    T["_"]["runResult"],
    T["_"]["from"],
    SelectResultFields<TSelectedFields>,
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type SQLiteEffectUpdateExecute<T extends AnySQLiteEffectUpdate> = T["_"]["returning"] extends undefined
  ? T["_"]["runResult"]
  : T["_"]["returning"][]

export type SQLiteEffectUpdatePrepare<
  T extends AnySQLiteEffectUpdate,
  TEffectHKT extends QueryEffectHKTBase = T["_"]["effectHKT"],
> = SQLiteEffectPreparedQuery<
  PreparedQueryConfig & {
    run: T["_"]["runResult"]
    all: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".all() cannot be used without .returning()">
      : T["_"]["returning"][]
    get: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".get() cannot be used without .returning()">
      : T["_"]["returning"]
    values: T["_"]["returning"] extends undefined
      ? DrizzleTypeError<".values() cannot be used without .returning()">
      : any[][]
    execute: SQLiteEffectUpdateExecute<T>
  },
  TEffectHKT
>

export type SQLiteEffectUpdateDynamic<T extends AnySQLiteEffectUpdate> = SQLiteEffectUpdate<
  T["_"]["table"],
  T["_"]["runResult"],
  T["_"]["from"],
  T["_"]["returning"],
  T["_"]["effectHKT"]
>

export type SQLiteEffectUpdate<
  TTable extends SQLiteTable = SQLiteTable,
  TRunResult = unknown,
  TFrom extends SQLiteTable | Subquery | SQLiteViewBase | SQL | undefined = undefined,
  TReturning extends Record<string, unknown> | undefined = Record<string, unknown> | undefined,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> = SQLiteEffectUpdateBase<TTable, TRunResult, TFrom, TReturning, true, never, TEffectHKT>

export type AnySQLiteEffectUpdate = SQLiteEffectUpdateBase<any, any, any, any, any, any, any>

export type SQLiteEffectUpdateJoinFn<T extends AnySQLiteEffectUpdate> = <
  TJoinedTable extends SQLiteTable | Subquery | SQLiteViewBase | SQL,
>(
  table: TJoinedTable,
  on:
    | ((
        updateTable: T["_"]["table"]["_"]["columns"],
        from: T["_"]["from"] extends SQLiteTable
          ? T["_"]["from"]["_"]["columns"]
          : T["_"]["from"] extends Subquery | SQLiteViewBase
            ? T["_"]["from"]["_"]["selectedFields"]
            : never,
      ) => SQL | undefined)
    | SQL
    | undefined,
) => T

export class SQLiteEffectUpdateBuilder<
  TTable extends SQLiteTable,
  TRunResult,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> {
  static readonly [entityKind]: string = "SQLiteEffectUpdateBuilder"

  declare readonly _: {
    readonly table: TTable
  }

  constructor(
    protected table: TTable,
    protected session: SQLiteEffectSession<TEffectHKT, TRunResult, any>,
    protected dialect: SQLiteDialect,
    private withList?: Subquery[],
  ) {}

  set(
    values: SQLiteUpdateSetSource<TTable>,
  ): SQLiteEffectUpdateWithout<
    SQLiteEffectUpdateBase<TTable, TRunResult, undefined, undefined, false, never, TEffectHKT>,
    false,
    "leftJoin" | "rightJoin" | "innerJoin" | "fullJoin"
  > {
    return new SQLiteEffectUpdateBase(
      this.table,
      mapUpdateSet(this.table, values),
      this.session,
      this.dialect,
      this.withList,
    ) as any
  }
}

export interface SQLiteEffectUpdateBase<
  TTable extends SQLiteTable = SQLiteTable,
  TRunResult = unknown,
  TFrom extends SQLiteTable | Subquery | SQLiteViewBase | SQL | undefined = undefined,
  TReturning = undefined,
  TDynamic extends boolean = false,
  _TExcludedMethods extends string = never,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> extends SQLWrapper,
    RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "sqlite">,
    Effect.Effect<
      TReturning extends undefined ? TRunResult : TReturning[],
      TEffectHKT["error"],
      TEffectHKT["context"]
    > {
  readonly _: {
    readonly dialect: "sqlite"
    readonly table: TTable
    readonly resultType: "async"
    readonly runResult: TRunResult
    readonly from: TFrom
    readonly returning: TReturning
    readonly dynamic: TDynamic
    readonly excludedMethods: _TExcludedMethods
    readonly result: TReturning extends undefined ? TRunResult : TReturning[]
    readonly effectHKT: TEffectHKT
  }
}

export class SQLiteEffectUpdateBase<
    TTable extends SQLiteTable = SQLiteTable,
    TRunResult = unknown,
    TFrom extends SQLiteTable | Subquery | SQLiteViewBase | SQL | undefined = undefined,
    TReturning = undefined,
    TDynamic extends boolean = false,
    _TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  >
  implements RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "sqlite">, SQLWrapper
{
  static readonly [entityKind]: string = "SQLiteEffectUpdate"

  /** @internal */
  config: SQLiteUpdateConfig

  constructor(
    table: TTable,
    set: UpdateSet,
    private effectSession: SQLiteEffectSession<TEffectHKT, TRunResult, any>,
    private effectDialect: SQLiteDialect,
    withList?: Subquery[],
  ) {
    this.config = { set, table, withList, joins: [] }
  }

  from<TFrom extends SQLiteTable | Subquery | SQLiteViewBase | SQL>(
    source: TFrom,
  ): SQLiteEffectUpdateWithJoins<this, TDynamic, TFrom> {
    this.config.from = source
    return this as any
  }

  private createJoin<TJoinType extends SQLiteSelectJoinConfig["joinType"]>(
    joinType: TJoinType,
  ): SQLiteEffectUpdateJoinFn<this> {
    return ((
      table: SQLiteTable | Subquery | SQLiteViewBase | SQL,
      on: ((updateTable: TTable, from: TFrom) => SQL | undefined) | SQL | undefined,
    ) => {
      const tableName = getTableLikeName(table)

      if (typeof tableName === "string" && this.config.joins.some((join) => join.alias === tableName)) {
        throw new Error(`Alias "${tableName}" is already used in this query`)
      }

      if (typeof on === "function") {
        const from = this.config.from
          ? is(table, SQLiteTable)
            ? getTableColumnsRuntime(table)
            : is(table, Subquery)
              ? table._.selectedFields
              : is(table, SQLiteViewBase)
                ? getViewSelectedFieldsRuntime(table).selectedFields
                : undefined
          : undefined
        on = on(
          new Proxy(
            this.config.table._.columns,
            new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" }),
          ) as any,
          from &&
            (new Proxy(from, new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" })) as any),
        )
      }

      this.config.joins.push({ on, table, joinType, alias: tableName })

      return this as any
    }) as any
  }

  leftJoin = this.createJoin("left")

  rightJoin = this.createJoin("right")

  innerJoin = this.createJoin("inner")

  fullJoin = this.createJoin("full")

  where(where: SQL | undefined): SQLiteEffectUpdateWithout<this, TDynamic, "where"> {
    this.config.where = where
    return this as any
  }

  orderBy(
    builder: (updateTable: TTable) => ValueOrArray<SQLiteColumn | SQL | SQL.Aliased>,
  ): SQLiteEffectUpdateWithout<this, TDynamic, "orderBy">
  orderBy(...columns: (SQLiteColumn | SQL | SQL.Aliased)[]): SQLiteEffectUpdateWithout<this, TDynamic, "orderBy">
  orderBy(
    ...columns:
      | [(updateTable: TTable) => ValueOrArray<SQLiteColumn | SQL | SQL.Aliased>]
      | (SQLiteColumn | SQL | SQL.Aliased)[]
  ): SQLiteEffectUpdateWithout<this, TDynamic, "orderBy"> {
    if (typeof columns[0] === "function") {
      const orderBy = columns[0](
        new Proxy(
          getTableColumnsRuntime(this.config.table),
          new SelectionProxyHandler({ sqlAliasedBehavior: "alias", sqlBehavior: "sql" }),
        ) as any,
      )

      this.config.orderBy = Array.isArray(orderBy) ? orderBy : [orderBy]
      return this as any
    }

    this.config.orderBy = columns as (SQLiteColumn | SQL | SQL.Aliased)[]
    return this as any
  }

  limit(limit: number | Placeholder): SQLiteEffectUpdateWithout<this, TDynamic, "limit"> {
    this.config.limit = limit
    return this as any
  }

  returning(): SQLiteEffectUpdateReturningAll<this, TDynamic>
  returning<TSelectedFields extends SelectedFields>(
    fields: TSelectedFields,
  ): SQLiteEffectUpdateReturning<this, TDynamic, TSelectedFields>
  returning(
    fields: SelectedFields = getTableColumnsRuntime(this.config.table),
  ): SQLiteEffectUpdateWithout<AnySQLiteEffectUpdate, TDynamic, "returning"> {
    this.config.returning = orderSelectedFields<SQLiteColumn>(fields)
    return this as any
  }

  /** @internal */
  getSQL(): SQL {
    return this.effectDialect.buildUpdateQuery(this.config)
  }

  toSQL(): Query {
    return this.effectDialect.sqlToQuery(this.getSQL())
  }

  /** @internal */
  _prepare(isOneTimeQuery = true): SQLiteEffectUpdatePrepare<this, TEffectHKT> {
    return this.effectSession[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](
      this.effectDialect.sqlToQuery(this.getSQL()),
      this.config.returning,
      this.config.returning ? "all" : "run",
      undefined,
      {
        type: "update",
        tables: extractUsedTable(this.config.table),
      },
    ) as SQLiteEffectUpdatePrepare<this, TEffectHKT>
  }

  prepare(): SQLiteEffectUpdatePrepare<this, TEffectHKT> {
    return this._prepare(false)
  }

  run: ReturnType<this["prepare"]>["run"] = (placeholderValues) => {
    return this._prepare().run(placeholderValues)
  }

  all: ReturnType<this["prepare"]>["all"] = (placeholderValues) => {
    return this._prepare().all(placeholderValues)
  }

  get: ReturnType<this["prepare"]>["get"] = (placeholderValues) => {
    return this._prepare().get(placeholderValues)
  }

  values: ReturnType<this["prepare"]>["values"] = (placeholderValues) => {
    return this._prepare().values(placeholderValues)
  }

  execute: ReturnType<this["prepare"]>["execute"] = (placeholderValues) => {
    return this._prepare().execute(placeholderValues)
  }

  $dynamic(): SQLiteEffectUpdateDynamic<this> {
    return this as any
  }
}

applyEffectWrapper(SQLiteEffectUpdateBase)
