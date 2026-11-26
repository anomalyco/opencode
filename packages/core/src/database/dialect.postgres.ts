import { sql } from "drizzle-orm"
import type { SQL, SQLWrapper } from "drizzle-orm"

export const kind = "postgres" as const

/**
 * PostgreSQL dialect helpers.
 *
 * JSON columns are declared text on the SQLite side, so every helper casts to
 * jsonb before using an operator. #>> returns NULL for a missing member and
 * for JSON null, matching json_extract; numbers are cast to double precision,
 * which is exact for every millisecond clock and token count in this schema.
 */
export const greatest = (a: SQLWrapper | number, b: SQLWrapper | number): SQL => sql`greatest(${a}, ${b})`

export const least = (a: SQLWrapper | number, b: SQLWrapper | number): SQL => sql`least(${a}, ${b})`

/** '$.$defs.$comment' -> '{defs,comment}' */
export const pathArray = (path: string): string => {
  const body = path.startsWith("$.") ? path.slice(2) : path
  if (body.length === 0) return "{}"
  return "{" + body.split(".").join(",") + "}"
}

/** Inlined, not bound: see the note in dialect.sqlite.ts about the parameter budget. */
const path = (value: string) => sql.raw("'" + pathArray(value).replaceAll("'", "''") + "'::text[]")

export const jsonText = (column: SQLWrapper, value: string): SQL =>
  sql`((${column})::jsonb #>> ${path(value)})`

export const jsonNumber = (column: SQLWrapper, value: string): SQL =>
  sql`(((${column})::jsonb #>> ${path(value)})::double precision)`

export const jsonArrayLength = (column: SQLWrapper, value: string): SQL =>
  sql`jsonb_array_length(coalesce((${column})::jsonb -> ${path(value)}, '[]'::jsonb))`

/**
 * Not a table function on this side: PostgreSQL spells array expansion as a
 * LATERAL join. Call sites that iterate a JSON array branch on kind and write
 * jsonb_array_elements directly; this stub keeps the imports symmetric.
 */
export const jsonArrayElements = (column: SQLWrapper, value: string): SQL =>
  sql`jsonb_array_elements(coalesce((${column})::jsonb -> ${path(value)}, '[]'::jsonb))`

/**
 * The FROM-clause suffix that expands a JSON array into rows named content,
 * with each element available as content.value. PostgreSQL has no table-valued
 * json_each, so this is a LATERAL join; coalesce keeps a missing or JSON-null
 * content from erroring.
 */
export const jsonArrayJoin = (column: SQLWrapper, value: string): SQL =>
  sql` CROSS JOIN LATERAL jsonb_array_elements(coalesce((${column})::jsonb -> ${path(value)}, '[]'::jsonb)) AS content(value)`

/**
 * Replaces the content array of a JSON document with the one already stored in
 * the row, leaving the rest of the document untouched. Cast back to text
 * because the column stays text for the SQLite schema mirror.
 */
export const jsonSetContent = (column: SQLWrapper, document: unknown): SQL =>
  sql`(jsonb_set(${JSON.stringify(document)}::jsonb, '{content}', coalesce((${column})::jsonb -> 'content', '[]'::jsonb)))::text`
