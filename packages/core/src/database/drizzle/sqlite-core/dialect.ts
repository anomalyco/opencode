/* oxlint-disable */
import { Column, getColumnTable } from "drizzle-orm/column"
import { entityKind, is } from "drizzle-orm/entity"
import { Name, SQL, StringChunk, sql, type BuildQueryConfig } from "drizzle-orm/sql/sql"
import { SQLiteDialect } from "drizzle-orm/sqlite-core/dialect"
import type { SQLiteUpdateConfig } from "drizzle-orm/sqlite-core/query-builders/update"
import type { SQLiteSelectConfig } from "drizzle-orm/sqlite-core/query-builders/select.types"
import { SQLiteTable } from "drizzle-orm/sqlite-core/table"
import { Table, getTableName } from "drizzle-orm/table"

const TableSymbol = (Table as unknown as { Symbol: { IsAlias: symbol; OriginalName: symbol } }).Symbol

type CollectSQL = (this: SQL, chunks: ReadonlyArray<unknown>, config: BuildQueryConfig, ...rest: Array<unknown>) => void
const collectSQL = (SQL.prototype as unknown as { collectSQL: CollectSQL }).collectSQL

/**
 * A name OpenCode owns that has no table declaration, such as an index or the
 * migration journal. `PrefixedSQLiteDialect` renders it under the prefix; any
 * other dialect renders it like `sql.identifier`.
 */
export class PrefixedIdentifier {
  static readonly [entityKind]: string = "PrefixedIdentifier"

  constructor(readonly value: string) {}

  getSQL() {
    return new SQL([new Name(this.value)])
  }

  shouldOmitSQLParens() {
    return true
  }
}

export function prefixedIdentifier(value: string) {
  return new PrefixedIdentifier(value)
}

/**
 * A SQLite dialect that stores every table and index as `<prefix><name>`, so OpenCode can
 * share a database with tables it does not own. Table definitions stay
 * unprefixed and shared; the prefix is applied when a query is rendered.
 *
 * Drizzle renders nested SQL through the root statement's `collectSQL`, so
 * wrapping the root lets it rename every table reference and `table.column`
 * qualifier. Joins are the one place Drizzle bakes a table name into a plain
 * identifier at build time, so they are passed through as table references.
 */
export class PrefixedSQLiteDialect extends SQLiteDialect {
  static override readonly [entityKind]: string = "PrefixedSQLiteDialect"

  constructor(
    readonly prefix: string,
    config?: ConstructorParameters<typeof SQLiteDialect>[0],
  ) {
    super(config)
  }

  override sqlToQuery(query: SQL, invokeSource?: "indexes") {
    const prefix = this.prefix
    const root = new SQL([query])
    Object.defineProperty(root, "collectSQL", {
      value(this: SQL, chunks: ReadonlyArray<unknown>, config: BuildQueryConfig, ...rest: Array<unknown>) {
        const columns = config.invokeSource !== "indexes"
        return collectSQL.call(
          this,
          chunks.map((chunk) => prefixed(chunk, prefix, columns)),
          config,
          ...rest,
        )
      },
    })
    return super.sqlToQuery(root, invokeSource)
  }

  override buildSelectQuery(config: SQLiteSelectConfig) {
    if (isAlias(config.table)) throw new Error("Table aliases are not supported with a database table prefix")
    return super.buildSelectQuery({ ...config, joins: config.joins?.map((join) => this.prefixedJoin(join)) })
  }

  override buildUpdateQuery(config: SQLiteUpdateConfig) {
    return super.buildUpdateQuery({ ...config, joins: config.joins.map((join) => this.prefixedJoin(join)) })
  }

  private prefixedJoin<Join extends { table: unknown; alias: string | undefined }>(join: Join): Join {
    if (!is(join.table, SQLiteTable)) return join
    if (!isAlias(join.table)) return { ...join, table: sql`${join.table}` }
    const original = (join.table as unknown as Record<symbol, string>)[TableSymbol.OriginalName]
    return {
      ...join,
      table: sql`${sql.identifier(this.prefix + original)} ${sql.identifier(getTableName(join.table))}`,
    }
  }
}

function prefixed(chunk: unknown, prefix: string, columns: boolean) {
  if (chunk instanceof PrefixedIdentifier) return new Name(prefix + chunk.value)
  if (is(chunk, Table) && !isAlias(chunk)) return new Name(prefix + getTableName(chunk))
  if (!columns || !is(chunk, Column) || chunk.isAlias || isAlias(getColumnTable(chunk))) return chunk
  return new SQL([new Name(prefix + getTableName(getColumnTable(chunk))), new StringChunk("."), new Name(chunk.name)])
}

function isAlias(table: unknown) {
  return is(table, Table) && (table as unknown as Record<symbol, boolean>)[TableSymbol.IsAlias] === true
}
