/* oxlint-disable */
import type * as Effect from "effect/Effect"
import { applyEffectWrapper, type QueryEffectHKTBase } from "drizzle-orm/effect-core/query-effect"
import { entityKind, is } from "drizzle-orm/entity"
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types"
import type { RunnableQuery } from "drizzle-orm/runnable-query"
import type { Query, SQLWrapper } from "drizzle-orm/sql/sql"
import { Param, SQL, sql } from "drizzle-orm/sql/sql"
import type { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import type { IndexColumn } from "drizzle-orm/sqlite-core/indexes"
import type {
  SQLiteInsertConfig,
  SQLiteInsertSelectQueryBuilder,
  SQLiteInsertValue,
} from "drizzle-orm/sqlite-core/query-builders/insert"
import type { SelectedFieldsFlat } from "drizzle-orm/sqlite-core/query-builders/select.types"
import type { PreparedQueryConfig } from "drizzle-orm/sqlite-core/session"
import { SQLiteTable } from "drizzle-orm/sqlite-core/table"
import { extractUsedTable } from "drizzle-orm/sqlite-core/utils"
import type { Subquery } from "drizzle-orm/subquery"
import { type DrizzleTypeError, haveSameKeys } from "drizzle-orm/utils"
import type { SQLiteColumn } from "drizzle-orm/sqlite-core/columns/common"
import { QueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query-builder"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core/query-builders/update"
import { getTableColumnsRuntime, mapUpdateSet, orderSelectedFields } from "../../internal/drizzle-utils"
import type { SQLiteEffectPreparedQuery, SQLiteEffectSession } from "./session"

export type SQLiteEffectInsertWithout<
  T extends AnySQLiteEffectInsert,
  TDynamic extends boolean,
  K extends keyof T & string,
> = TDynamic extends true
  ? T
  : Omit<
      SQLiteEffectInsertBase<
        T["_"]["table"],
        T["_"]["runResult"],
        T["_"]["returning"],
        TDynamic,
        T["_"]["excludedMethods"] | K,
        T["_"]["effectHKT"]
      >,
      T["_"]["excludedMethods"] | K
    >

export type SQLiteEffectInsertReturning<
  T extends AnySQLiteEffectInsert,
  TDynamic extends boolean,
  TSelectedFields extends SelectedFieldsFlat,
> = SQLiteEffectInsertWithout<
  SQLiteEffectInsertBase<
    T["_"]["table"],
    T["_"]["runResult"],
    SelectResultFields<TSelectedFields>,
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type SQLiteEffectInsertReturningAll<
  T extends AnySQLiteEffectInsert,
  TDynamic extends boolean,
> = SQLiteEffectInsertWithout<
  SQLiteEffectInsertBase<
    T["_"]["table"],
    T["_"]["runResult"],
    T["_"]["table"]["$inferSelect"],
    TDynamic,
    T["_"]["excludedMethods"],
    T["_"]["effectHKT"]
  >,
  TDynamic,
  "returning"
>

export type SQLiteEffectInsertDynamic<T extends AnySQLiteEffectInsert> = SQLiteEffectInsert<
  T["_"]["table"],
  T["_"]["runResult"],
  T["_"]["returning"],
  T["_"]["effectHKT"]
>

export type SQLiteEffectInsertOnConflictDoUpdateConfig<T extends AnySQLiteEffectInsert> = {
  target: IndexColumn | IndexColumn[]
  /** @deprecated - use either `targetWhere` or `setWhere` */
  where?: SQL
  targetWhere?: SQL
  setWhere?: SQL
  set: SQLiteUpdateSetSource<T["_"]["table"]>
}

export type SQLiteEffectInsertExecute<T extends AnySQLiteEffectInsert> = T["_"]["returning"] extends undefined
  ? T["_"]["runResult"]
  : T["_"]["returning"][]

export type SQLiteEffectInsertPrepare<
  T extends AnySQLiteEffectInsert,
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
    execute: SQLiteEffectInsertExecute<T>
  },
  TEffectHKT
>

export type SQLiteEffectInsert<
  TTable extends SQLiteTable = SQLiteTable,
  TRunResult = unknown,
  TReturning = any,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> = SQLiteEffectInsertBase<TTable, TRunResult, TReturning, true, never, TEffectHKT>

export type AnySQLiteEffectInsert = SQLiteEffectInsertBase<any, any, any, any, any, any>

export class SQLiteEffectInsertBuilder<
  TTable extends SQLiteTable,
  TRunResult,
  TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
> {
  static readonly [entityKind]: string = "SQLiteEffectInsertBuilder"

  constructor(
    protected table: TTable,
    protected session: SQLiteEffectSession<TEffectHKT, TRunResult, any>,
    protected dialect: SQLiteDialect,
    private withList?: Subquery[],
  ) {}

  values(
    value: SQLiteInsertValue<TTable>,
  ): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  values(
    values: SQLiteInsertValue<TTable>[],
  ): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  values(
    values: SQLiteInsertValue<TTable> | SQLiteInsertValue<TTable>[],
  ): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
    values = Array.isArray(values) ? values : [values]
    if (values.length === 0) {
      throw new Error("values() must be called with at least one value")
    }
    const mappedValues = values.map((entry) => {
      const result: Record<string, Param | SQL> = {}
      const cols = getTableColumnsRuntime(this.table)
      for (const colKey of Object.keys(entry)) {
        const colValue = entry[colKey as keyof typeof entry]
        result[colKey] = is(colValue, SQL) ? colValue : new Param(colValue, cols[colKey])
      }
      return result
    })

    return new SQLiteEffectInsertBase(this.table, mappedValues, this.session, this.dialect, this.withList)
  }

  select(
    selectQuery: (qb: QueryBuilder) => SQLiteInsertSelectQueryBuilder<TTable>,
  ): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(
    selectQuery: (qb: QueryBuilder) => SQL,
  ): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(selectQuery: SQL): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(
    selectQuery: SQLiteInsertSelectQueryBuilder<TTable>,
  ): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT>
  select(
    selectQuery:
      | SQL
      | SQLiteInsertSelectQueryBuilder<TTable>
      | ((qb: QueryBuilder) => SQLiteInsertSelectQueryBuilder<TTable> | SQL),
  ): SQLiteEffectInsertBase<TTable, TRunResult, undefined, false, never, TEffectHKT> {
    const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder()) : selectQuery

    if (!is(select, SQL) && !haveSameKeys(getTableColumnsRuntime(this.table), select._.selectedFields)) {
      throw new Error(
        "Insert select error: selected fields are not the same or are in a different order compared to the table definition",
      )
    }

    return new SQLiteEffectInsertBase(this.table, select, this.session, this.dialect, this.withList, true)
  }
}

export interface SQLiteEffectInsertBase<
  TTable extends SQLiteTable,
  TRunResult,
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
    readonly returning: TReturning
    readonly dynamic: TDynamic
    readonly excludedMethods: _TExcludedMethods
    readonly result: TReturning extends undefined ? TRunResult : TReturning[]
    readonly effectHKT: TEffectHKT
  }
}

export class SQLiteEffectInsertBase<
    TTable extends SQLiteTable,
    TRunResult,
    TReturning = undefined,
    TDynamic extends boolean = false,
    _TExcludedMethods extends string = never,
    TEffectHKT extends QueryEffectHKTBase = QueryEffectHKTBase,
  >
  implements RunnableQuery<TReturning extends undefined ? TRunResult : TReturning[], "sqlite">, SQLWrapper
{
  static readonly [entityKind]: string = "SQLiteEffectInsert"

  /** @internal */
  config: SQLiteInsertConfig<TTable>

  constructor(
    private table: TTable,
    values: SQLiteInsertConfig["values"],
    private effectSession: SQLiteEffectSession<TEffectHKT, TRunResult, any>,
    private effectDialect: SQLiteDialect,
    withList?: Subquery[],
    select?: boolean,
  ) {
    this.config = { table, values: values as any, withList, select }
  }

  returning(): SQLiteEffectInsertReturningAll<this, TDynamic>
  returning<TSelectedFields extends SelectedFieldsFlat>(
    fields: TSelectedFields,
  ): SQLiteEffectInsertReturning<this, TDynamic, TSelectedFields>
  returning(
    fields: SelectedFieldsFlat = getTableColumnsRuntime(this.config.table),
  ): SQLiteEffectInsertWithout<AnySQLiteEffectInsert, TDynamic, "returning"> {
    this.config.returning = orderSelectedFields<SQLiteColumn>(fields)
    return this as any
  }

  onConflictDoNothing(config: { target?: IndexColumn | IndexColumn[]; where?: SQL } = {}): this {
    if (!this.config.onConflict) this.config.onConflict = []

    if (config.target === undefined) {
      this.config.onConflict.push(sql` on conflict do nothing`)
      return this
    }

    const targetSql = Array.isArray(config.target) ? sql`${config.target}` : sql`${[config.target]}`
    const whereSql = config.where ? sql` where ${config.where}` : sql``
    this.config.onConflict.push(sql` on conflict ${targetSql} do nothing${whereSql}`)
    return this
  }

  onConflictDoUpdate(config: SQLiteEffectInsertOnConflictDoUpdateConfig<this>): this {
    if (config.where && (config.targetWhere || config.setWhere)) {
      throw new Error(
        'You cannot use both "where" and "targetWhere"/"setWhere" at the same time - "where" is deprecated, use "targetWhere" or "setWhere" instead.',
      )
    }

    if (!this.config.onConflict) this.config.onConflict = []

    const whereSql = config.where ? sql` where ${config.where}` : undefined
    const targetWhereSql = config.targetWhere ? sql` where ${config.targetWhere}` : undefined
    const setWhereSql = config.setWhere ? sql` where ${config.setWhere}` : undefined
    const targetSql = Array.isArray(config.target) ? sql`${config.target}` : sql`${[config.target]}`
    const setSql = this.effectDialect.buildUpdateSet(
      this.config.table,
      mapUpdateSet(this.config.table, config.set as SQLiteUpdateSetSource<TTable>),
    )
    this.config.onConflict.push(
      sql` on conflict ${targetSql}${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`,
    )
    return this
  }

  /** @internal */
  getSQL(): SQL {
    return this.effectDialect.buildInsertQuery(this.config)
  }

  toSQL(): Query {
    return this.effectDialect.sqlToQuery(this.getSQL())
  }

  /** @internal */
  _prepare(isOneTimeQuery = true): SQLiteEffectInsertPrepare<this, TEffectHKT> {
    return this.effectSession[isOneTimeQuery ? "prepareOneTimeQuery" : "prepareQuery"](
      this.effectDialect.sqlToQuery(this.getSQL()),
      this.config.returning,
      this.config.returning ? "all" : "run",
      undefined,
      {
        type: "insert",
        tables: extractUsedTable(this.config.table),
      },
    ) as SQLiteEffectInsertPrepare<this, TEffectHKT>
  }

  prepare(): SQLiteEffectInsertPrepare<this, TEffectHKT> {
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

  $dynamic(): SQLiteEffectInsertDynamic<this> {
    return this as any
  }
}

applyEffectWrapper(SQLiteEffectInsertBase)
