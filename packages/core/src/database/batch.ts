export * as DatabaseBatch from "./batch.js"

import { getTableColumns, type Table } from "drizzle-orm"

/** Durable Object SQLite rejects a statement that binds more than 100 parameters, so every runtime stays under it. */
export const MaxBoundParameters = 100

/**
 * Splits `items` into batches whose statement binds at most {@link MaxBoundParameters}: `perItem` parameters for each
 * item (a multi-row insert binds one per column) plus `fixed` for the rest of the statement.
 */
export const batches = <T>(items: ReadonlyArray<T>, perItem: number, fixed = 0): Array<Array<T>> => {
  const size = Math.max(1, Math.floor((MaxBoundParameters - fixed) / perItem))
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )
}

/** {@link batches} for a multi-row insert into `table`, which binds one parameter per column of each row. */
export const insertBatches = <T>(table: Table, rows: ReadonlyArray<T>, fixed = 0) =>
  batches(rows, Object.keys(getTableColumns(table)).length, fixed)
