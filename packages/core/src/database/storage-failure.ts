export * as StorageFailure from "./storage-failure.js"

import { resultCode } from "#sqlite"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Cause } from "effect"
import { isSqlError, type SqlError } from "effect/sql/SqlError"

// SQLite primary result codes that mean storage itself can't be used, as opposed to a bad statement or a constraint,
// each with a message that doesn't name the database engine, since callers only know about "storage". BUSY and LOCKED
// only surface once a write has already waited out `busy_timeout`, so the write is lost just like on a full disk.
const messages = new Map([
  [5, "Storage is in use by another process"], // SQLITE_BUSY
  [6, "Storage is in use by another process"], // SQLITE_LOCKED
  [8, "Storage is read-only"], // SQLITE_READONLY
  [10, "Storage couldn't be read or written"], // SQLITE_IOERR
  [11, "Storage is damaged"], // SQLITE_CORRUPT
  [13, "Storage is full"], // SQLITE_FULL
  [14, "Storage couldn't be opened"], // SQLITE_CANTOPEN
  [26, "Storage is damaged"], // SQLITE_NOTADB
])

/** The readable message for the storage failure that failed an effect, if that is what failed it. */
export function message(cause: Cause.Cause<unknown>) {
  return sqlErrors(cause)
    .map(fromSqlError)
    .find((found) => found !== undefined)
}

/** The readable message for a SqlError the driver reported as a storage failure. */
export function fromSqlError(error: SqlError) {
  const code = resultCode(error.reason.cause)
  // An extended result code (SQLITE_IOERR_WRITE) keeps its primary code in the low byte.
  return code === undefined ? undefined : messages.get(code & 0xff)
}

// Result codes after which SQLite may have rolled the whole transaction back itself
// (https://www.sqlite.org/lang_transaction.html#response_to_errors_within_a_transaction): SQLITE_FULL, SQLITE_IOERR,
// SQLITE_BUSY, SQLITE_NOMEM and SQLITE_INTERRUPT.
const autoRollback = new Set([5, 7, 9, 10, 13])

/** Whether SQLite may have already rolled back the transaction this cause failed, so a rollback has nothing to undo. */
export function rolledBack(cause: Cause.Cause<unknown>) {
  return sqlErrors(cause).some((error) => {
    const code = resultCode(error.reason.cause)
    return code !== undefined && autoRollback.has(code & 0xff)
  })
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
