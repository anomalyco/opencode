import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Cause, Duration, Predicate, Schedule } from "effect"
import { isSqlError } from "effect/sql/SqlError"

// Keep each synchronous SQLite busy wait well below the client's 2s /api/info
// probe timeout so boot retries yield to the event loop instead of freezing it.
export const BOOT_BUSY_TIMEOUT_MS = 250
export const STEADY_BUSY_TIMEOUT_MS = 5_000
export const bootBusyTimeout = Duration.millis(BOOT_BUSY_TIMEOUT_MS)

export const bootLockRetrySchedule = Schedule.min([
  Schedule.exponential("50 millis"),
  Schedule.spaced("500 millis"),
]).pipe(Schedule.upTo({ duration: "30 seconds" }))

const TRANSIENT_LOCK_MESSAGE = /database(?: table)? is locked|sqlite_busy|sqlite_locked/i

export function isTransientSqliteLockError(error: unknown, seen = new Set<unknown>()): boolean {
  if (error === null || error === undefined || seen.has(error)) return false
  seen.add(error)

  if (Cause.isCause(error)) {
    return error.reasons.some((reason) => {
      if (Cause.isInterruptReason(reason)) return false
      return isTransientSqliteLockError(Cause.isFailReason(reason) ? reason.error : reason.defect, seen)
    })
  }

  if (isSqlError(error)) {
    if (error.reason._tag === "LockTimeoutError") return true
    return isTransientSqliteLockError(error.reason.cause, seen)
  }

  if (error instanceof EffectDrizzleQueryError) return isTransientSqliteLockError(error.cause, seen)
  if (!Predicate.isObject(error)) return false

  if (hasBusyResultCode(error)) return true
  if (Predicate.hasProperty(error, "code") && Predicate.isString(error.code) && isBusyCodeString(error.code))
    return true
  if (
    Predicate.hasProperty(error, "message") &&
    Predicate.isString(error.message) &&
    TRANSIENT_LOCK_MESSAGE.test(error.message)
  )
    return true

  if (Predicate.hasProperty(error, "cause")) return isTransientSqliteLockError(error.cause, seen)
  return false
}

function hasBusyResultCode(error: object) {
  const numeric =
    Predicate.hasProperty(error, "errno") && Predicate.isNumber(error.errno)
      ? error.errno
      : Predicate.hasProperty(error, "errcode") && Predicate.isNumber(error.errcode)
        ? error.errcode
        : undefined
  if (numeric === undefined) return false
  const primary = numeric & 0xff
  return primary === 5 || primary === 6
}

function isBusyCodeString(code: string) {
  return (
    code === "SQLITE_BUSY" ||
    code.startsWith("SQLITE_BUSY_") ||
    code === "SQLITE_LOCKED" ||
    code.startsWith("SQLITE_LOCKED_")
  )
}
