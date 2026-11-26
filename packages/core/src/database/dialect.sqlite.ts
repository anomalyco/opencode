import { sql } from "drizzle-orm"
import type { SQL, SQLWrapper } from "drizzle-orm"

export const kind = "sqlite" as const

/**
 * SQLite dialect helpers.
 *
 * Every function here exists so runtime queries can be written once and still
 * run on both engines. The SQLite side is the historical spelling; the
 * PostgreSQL side lives in dialect.postgres.ts.
 */
export const greatest = (a: SQLWrapper | number, b: SQLWrapper | number): SQL => sql`max(${a}, ${b})`

export const least = (a: SQLWrapper | number, b: SQLWrapper | number): SQL => sql`min(${a}, ${b})`

/**
 * The path is a compile-time constant, so it is inlined rather than bound: a
 * bound path would add one parameter to every call and push callers that
 * budget for SQLite's 100-parameter limit over it.
 */
const path = (value: string) => sql.raw("'" + value.replaceAll("'", "''") + "'")

/** A JSON member as a SQL text value, or NULL when it is absent. */
export const jsonText = (column: SQLWrapper, value: string): SQL => sql`json_extract(${column}, ${path(value)})`

/** A JSON member as a SQL number, or NULL when it is absent. */
export const jsonNumber = jsonText

export const jsonArrayLength = (column: SQLWrapper, value: string): SQL =>
  sql`json_array_length(${column}, ${path(value)})`

/** The expression that yields each element of a JSON array in a table join. */
export const jsonArrayElements = (column: SQLWrapper, value: string): SQL => sql`json_each(${column}, ${path(value)})`

/**
 * The FROM-clause suffix that expands a JSON array into rows named content,
 * with each element available as content.value.
 */
export const jsonArrayJoin = (column: SQLWrapper, value: string): SQL =>
  sql`, json_each(${column}, ${path(value)}) AS content`

/**
 * Replaces the content array of a JSON document with the one already stored in
 * the row, leaving the rest of the document untouched.
 */
export const jsonSetContent = (column: SQLWrapper, document: unknown): SQL =>
  sql`json_set(${JSON.stringify(document)}, '$.content', json(coalesce(json_extract(${column}, '$.content'), '[]')))`
