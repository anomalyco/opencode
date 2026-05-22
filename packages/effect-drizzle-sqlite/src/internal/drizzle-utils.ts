/* oxlint-disable */
import { Column, getColumnTable } from "drizzle-orm/column"
import { is } from "drizzle-orm/entity"
import type { JoinNullability } from "drizzle-orm/query-builders/select.types"
import { Param, SQL } from "drizzle-orm/sql/sql"
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types"
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core/query-builders/update"
import type { SQLiteTable } from "drizzle-orm/sqlite-core/table"
import { SQLiteViewBase } from "drizzle-orm/sqlite-core/view-base"
import { Subquery } from "drizzle-orm/subquery"
import { Table, getTableName } from "drizzle-orm/table"
import type { UpdateSet } from "drizzle-orm/utils"
import { ViewBaseConfig } from "drizzle-orm/view-common"

const TableSymbol = (
  Table as unknown as {
    Symbol: { Columns: symbol; IsAlias: symbol; Name: symbol; BaseName: symbol }
  }
).Symbol

export function getTableColumnsRuntime(table: SQLiteTable) {
  return (table as unknown as Record<symbol, Record<string, Column>>)[TableSymbol.Columns]
}

export function getViewSelectedFieldsRuntime(view: SQLiteViewBase) {
  return (view as unknown as Record<symbol, { selectedFields: Record<string, unknown>; name: string }>)[ViewBaseConfig]
}

export function jitCompatCheck(isEnabled: boolean | undefined) {
  if (!isEnabled) return false
  try {
    return new Function("input", '"use strict"; return input;')(true) === true
  } catch {
    return false
  }
}

export function orderSelectedFields<TColumn extends Column>(
  fields: Record<string, unknown>,
  pathPrefix?: string[],
): SelectedFieldsOrdered {
  return Object.entries(fields).flatMap(([name, field]) => {
    const path = pathPrefix ? [...pathPrefix, name] : [name]
    if (is(field, Column) || is(field, SQL) || is(field, SQL.Aliased) || is(field, Subquery)) {
      return [{ path, field }] as SelectedFieldsOrdered
    }
    if (is(field, Table)) return orderSelectedFields(getTableColumnsRuntime(field as SQLiteTable), path)
    return orderSelectedFields(field as Record<string, unknown>, path)
  }) as SelectedFieldsOrdered
}

export function mapUpdateSet<TTable extends SQLiteTable>(table: TTable, values: SQLiteUpdateSetSource<TTable>) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined)
  if (entries.length === 0) throw new Error("No values to set")

  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      is(value, SQL) || is(value, Column) ? value : new Param(value, getTableColumnsRuntime(table)[key]),
    ]),
  ) as UpdateSet
}

export function mapResultRow(
  columns: SelectedFieldsOrdered,
  row: unknown[],
  joinsNotNullableMap: Record<string, boolean> | undefined,
) {
  const nullifyMap: Record<string, string | false> = {}
  const result: Record<string, unknown> = {}

  columns.forEach((column, columnIndex) => {
    const decoder = (
      is(column.field, Column)
        ? column.field
        : is(column.field, SQL)
          ? (column.field as unknown as { decoder: { mapFromDriverValue(value: unknown): unknown } }).decoder
          : is(column.field, Subquery)
            ? (column.field._.sql as unknown as { decoder: { mapFromDriverValue(value: unknown): unknown } }).decoder
            : (column.field.sql as unknown as { decoder: { mapFromDriverValue(value: unknown): unknown } }).decoder
    ) as {
      mapFromDriverValue(value: unknown): unknown
    }
    const rawValue = row[columnIndex]
    const value = rawValue === null ? null : decoder.mapFromDriverValue(rawValue)
    const objectName = column.path[0]
    let node = result

    column.path.forEach((pathChunk, pathChunkIndex) => {
      if (pathChunkIndex === column.path.length - 1) {
        node[pathChunk] = value
        return
      }
      node[pathChunk] = (node[pathChunk] ?? {}) as Record<string, unknown>
      node = node[pathChunk] as Record<string, unknown>
    })

    if (joinsNotNullableMap && is(column.field, Column) && column.path.length === 2 && objectName) {
      const tableName = getTableName(getColumnTable(column.field))
      nullifyMap[objectName] =
        !(objectName in nullifyMap) && value === null
          ? tableName
          : typeof nullifyMap[objectName] === "string" && nullifyMap[objectName] !== tableName
            ? false
            : nullifyMap[objectName]
    }
  })

  Object.entries(nullifyMap).forEach(([objectName, tableName]) => {
    if (typeof tableName === "string" && !joinsNotNullableMap?.[tableName]) result[objectName] = null
  })

  return result
}

export function getTableLikeName(table: SQLiteTable | Subquery | SQLiteViewBase | SQL) {
  if (is(table, Subquery)) return table._.alias
  if (is(table, SQLiteViewBase)) return getViewSelectedFieldsRuntime(table).name
  if (is(table, SQL)) return undefined
  return (table as unknown as Record<symbol, string | boolean>)[
    (table as unknown as Record<symbol, string | boolean>)[TableSymbol.IsAlias]
      ? TableSymbol.Name
      : TableSymbol.BaseName
  ] as string
}

export type { JoinNullability }
