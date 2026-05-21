export * as DatabaseMigration from "./migration"

import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect } from "effect"
import { getTableName, sql, type SQL, type Table } from "drizzle-orm"
import { getTableConfig, type AnySQLiteTable, type Index, type SQLiteColumn } from "drizzle-orm/sqlite-core"

export type SchemaAst = {
  tables: Record<string, TableAst>
}

export type TableAst = {
  name: string
  columns: Record<string, ColumnAst>
  indexes: Record<string, IndexAst>
}

export type ColumnAst = {
  name: string
  type: string
  notNull: boolean
  primaryKey: boolean
  default?: string
}

export type IndexAst = {
  name: string
  table: string
  columns: IndexColumnAst[]
  unique: boolean
  where?: string
}

export type IndexColumnAst = { type: "column"; name: string } | { type: "expression"; sql: string }

export type Operation =
  | { type: "create_table"; table: TableAst }
  | { type: "add_column"; table: string; column: ColumnAst }
  | { type: "create_index"; index: IndexAst }

export function diff(db: EffectDrizzleSqlite.EffectSQLiteDatabase, tables: Table[]) {
  return read(db).pipe(Effect.map((actual) => diffSchema(actual, fromTables(tables))))
}

export function apply(db: EffectDrizzleSqlite.EffectSQLiteDatabase, operations: Operation[]) {
  return Effect.forEach(operations, (operation) => db.run(toSql(operation))).pipe(Effect.asVoid)
}

function fromTables(tables: Table[]): SchemaAst {
  return {
    tables: Object.fromEntries(tables.map((table) => {
      const config = getTableConfig(table as AnySQLiteTable)
      const name = getTableName(table)
      return [name, tableFromConfig(name, config.columns, config.indexes)]
    })),
  }
}

function diffSchema(actual: SchemaAst, desired: SchemaAst): Operation[] {
  return Object.values(desired.tables).flatMap<Operation>((table) => {
    const current = actual.tables[table.name]
    if (!current) {
      return [createTableOperation(table), ...Object.values(table.indexes).map(createIndexOperation)]
    }
    return [
      ...Object.values(table.columns)
        .filter((column) => current.columns[column.name] === undefined)
        .map((column) => addColumnOperation(table.name, column)),
      ...Object.values(table.indexes)
        .filter((index) => current.indexes[index.name] === undefined)
        .map(createIndexOperation),
    ]
  })
}

function createTableOperation(table: TableAst): Operation {
  return { type: "create_table", table }
}

function addColumnOperation(table: string, column: ColumnAst): Operation {
  return { type: "add_column", table, column }
}

function createIndexOperation(index: IndexAst): Operation {
  return { type: "create_index", index }
}

function toSql(operation: Operation) {
  if (operation.type === "create_table") {
    return `CREATE TABLE ${quoteIdentifier(operation.table.name)} (${Object.values(operation.table.columns)
      .map((column) => columnSql(column, true))
      .join(", ")})`
  }
  if (operation.type === "add_column") {
    return `ALTER TABLE ${quoteIdentifier(operation.table)} ADD COLUMN ${columnSql(operation.column, false)}`
  }
  return [
    "CREATE",
    operation.index.unique ? "UNIQUE" : undefined,
    "INDEX",
    quoteIdentifier(operation.index.name),
    "ON",
    quoteIdentifier(operation.index.table),
    `(${operation.index.columns.map(indexColumnSql).join(", ")})`,
    operation.index.where === undefined ? undefined : `WHERE ${operation.index.where}`,
  ]
    .filter((part) => part !== undefined)
    .join(" ")
}

function read(db: EffectDrizzleSqlite.EffectSQLiteDatabase) {
  return Effect.gen(function* () {
    const rows = yield* db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    const tables = yield* Effect.forEach(rows, (row) => readTable(db, row.name))
    return { tables: Object.fromEntries(tables.map((table) => [table.name, table])) }
  })
}

function readTable(db: EffectDrizzleSqlite.EffectSQLiteDatabase, name: string) {
  return Effect.gen(function* () {
    const columns = yield* db.all<{
      name: string
      type: string
      notnull: number
      pk: number
      dflt_value: string | null
    }>(`PRAGMA table_info(${quoteIdentifier(name)})`)
    const indexes = yield* db.all<{ name: string; unique: number }>(`PRAGMA index_list(${quoteIdentifier(name)})`)
    const indexEntries = yield* Effect.forEach(indexes, (index) =>
      Effect.gen(function* () {
        const statement = yield* db.get<{ sql: string | null }>(sql`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ${index.name}`)
        if (statement?.sql === null || statement?.sql === undefined) return undefined
        const columns = yield* db.all<{ seqno: number; name: string | null }>(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
        return [
          index.name,
          {
            name: index.name,
            table: name,
            columns: columns.map((column) =>
              column.name === null
                ? ({ type: "expression", sql: "" } as const)
                : ({ type: "column", name: column.name } as const),
            ),
            unique: index.unique === 1,
          },
        ] as const
      }),
    )
    return {
      name,
      columns: Object.fromEntries(columns.map((column) => [
        column.name,
        {
          name: column.name,
          type: column.type,
          notNull: column.notnull === 1,
          primaryKey: column.pk > 0,
          ...(column.dflt_value === null ? {} : { default: column.dflt_value }),
        },
      ])),
      indexes: Object.fromEntries(indexEntries.filter((entry) => entry !== undefined)),
    }
  })
}

function tableFromConfig(name: string, columns: SQLiteColumn[], indexes: Index[]): TableAst {
  return {
    name,
    columns: Object.fromEntries(columns.map((column) => [column.name, columnFromConfig(column)])),
    indexes: Object.fromEntries(indexes.map((index) => [index.config.name, indexFromConfig(index)])),
  }
}

function columnFromConfig(column: SQLiteColumn): ColumnAst {
  return {
    name: column.name,
    type: column.getSQLType(),
    notNull: column.notNull,
    primaryKey: column.primary,
    ...defaultFromColumn(column),
  }
}

function defaultFromColumn(column: SQLiteColumn) {
  if (column.default !== undefined) return { default: literal(column.default) }
  if (column.defaultFn !== undefined) return { default: literal(column.defaultFn()) }
  return {}
}

function indexFromConfig(index: Index): IndexAst {
  return {
    name: index.config.name,
    table: getTableName(index.config.table),
    columns: index.config.columns.map(indexColumnName),
    unique: index.config.unique,
    ...(index.config.where === undefined ? {} : { where: compileSql(index.config.where) }),
  }
}

function indexColumnName(column: SQLiteColumn | SQL) {
  if ("name" in column) return { type: "column", name: column.name } as const
  return { type: "expression", sql: compileSql(column) } as const
}

function compileSql(value: SQL) {
  return value.getSQL().toQuery(new SQLiteCompiler()).sql.replace(/"(?:""|[^"])*"\./g, "")
}

function indexColumnSql(column: IndexColumnAst) {
  if (column.type === "column") return quoteIdentifier(column.name)
  return column.sql
}

function columnSql(column: ColumnAst, includePrimaryKey: boolean) {
  return [
    quoteIdentifier(column.name),
    column.type,
    includePrimaryKey && column.primaryKey ? "PRIMARY KEY" : undefined,
    column.notNull ? "NOT NULL" : undefined,
    column.default === undefined ? undefined : `DEFAULT ${column.default}`,
  ]
    .filter((part) => part !== undefined)
    .join(" ")
}

class SQLiteCompiler {
  inlineParams = true
  escapeName = (name: string) => {
    return quoteIdentifier(name)
  }
  escapeParam = () => {
    return "?"
  }
  escapeString = (value: string) => {
    return `'${value.replaceAll("'", "''")}'`
  }
}

function literal(value: unknown) {
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "1" : "0"
  if (value === null) return "NULL"
  return `'${String(value).replaceAll("'", "''")}'`
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
