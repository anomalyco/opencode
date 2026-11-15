export * as StorageFailure from "./storage-failure.js"

import { driverError } from "#sqlite"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Cause } from "effect"
import { isSqlError, type SqlError } from "effect/sql/SqlError"

// SQLite primary result codes that mean the database itself can't be used, as opposed to a bad statement or a
// constraint, with SQLite's own text for when the driver error has none. BUSY and LOCKED only surface once a write has
// already waited out `busy_timeout`, so the write is lost just like on a full disk.
const reasons = new Map([
  [5, "database is locked"], // SQLITE_BUSY
  [6, "database table is locked"], // SQLITE_LOCKED
  [8, "attempt to write a readonly database"], // SQLITE_READONLY
  [10, "disk I/O error"], // SQLITE_IOERR
  [11, "database disk image is malformed"], // SQLITE_CORRUPT
  [13, "database or disk is full"], // SQLITE_FULL
  [14, "unable to open database file"], // SQLITE_CANTOPEN
  [26, "file is not a database"], // SQLITE_NOTADB
])

/** The readable message for the storage failure that failed an effect, if that is what failed it. */
export function message(cause: Cause.Cause<unknown>) {
  return sqlErrors(cause)
    .map(fromSqlError)
    .find((found) => found !== undefined)
}

/** The readable message for a SqlError the driver reported as a storage failure. */
export function fromSqlError(error: SqlError) {
  const driver = driverError(error.reason.cause)
  if (!driver) return undefined
  // An extended result code (SQLITE_IOERR_WRITE) keeps its primary code in the low byte.
  const reason = reasons.get(driver.code & 0xff)
  return reason === undefined ? undefined : `Storage error: ${driver.message || reason}`
}

// A failed transaction boundary is a SqlError; a failed query is a query error holding the Cause of its SqlError.
function sqlErrors(cause: Cause.Cause<unknown>): SqlError[] {
  return cause.reasons.flatMap((reason) => {
    if (Cause.isInterruptReason(reason)) return []
    const error = Cause.isFailReason(reason) ? reason.error : reason.defect
    if (isSqlError(error)) return [error]
    if (error instanceof EffectDrizzleQueryError && Cause.isCause(error.cause)) return sqlErrors(error.cause)
    return []
  })
}
