export * as StorageRetry from "./storage-retry.js"

import { Cause, Effect, Schedule } from "effect"

// Result codes that clear without intervention: a full disk or failed write once space frees,
// a busy or locked database once the other writer finishes. SQLite rolls the transaction back
// on these, so rerunning a whole transaction cannot apply it twice.
const TRANSIENT_CODES = ["SQLITE_FULL", "SQLITE_IOERR", "SQLITE_BUSY", "SQLITE_LOCKED"]
const TRANSIENT_PRIMARY_CODES = new Set([5, 6, 10, 13])

/** Short enough to answer a waiting request, long enough to ride out a brief full disk. */
export const write = Schedule.min([Schedule.exponential("100 millis"), Schedule.spaced("2 seconds")]).pipe(
  Schedule.upTo({ duration: "30 seconds" }),
)

/** For records that must eventually land, such as a terminal outcome nothing else can report. */
export const settlement = Schedule.min([Schedule.exponential("1 second"), Schedule.spaced("10 seconds")]).pipe(
  Schedule.upTo({ duration: "15 minutes" }),
)

/** Whether a failure or Cause comes from storage that may accept the same write later. */
export function isTransient(cause: unknown): boolean {
  return transient(cause, 0) !== undefined
}

/** Reruns an atomic storage effect while its failure is transient, including SQL defects. */
export const retry =
  (schedule: Schedule.Schedule<unknown, Cause.Cause<unknown>> = write) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.sandbox,
      Effect.retry({ schedule, while: isTransient }),
      Effect.catch(Effect.failCause),
    )

/** The SQLite message behind a storage failure, such as "database or disk is full". */
export function message(cause: unknown): string | undefined {
  const error = transient(cause, 0)
  return error instanceof Error && error.message ? error.message : undefined
}

function transient(value: unknown, depth: number): object | undefined {
  if (depth > 8 || typeof value !== "object" || value === null) return undefined
  if (Cause.isCause(value)) {
    if (Cause.hasInterrupts(value) || value.reasons.length === 0) return undefined
    let match: object | undefined
    for (const reason of value.reasons) {
      const found = transient(reasonValue(reason), depth + 1)
      if (!found) return undefined
      match ??= found
    }
    return match
  }
  const code = sqliteCode(value)
  if (code !== undefined) return code ? value : undefined
  return "cause" in value ? transient(value.cause, depth + 1) : undefined
}

function reasonValue(reason: Cause.Reason<unknown>) {
  if (Cause.isFailReason(reason)) return reason.error
  if (Cause.isDieReason(reason)) return reason.defect
  return undefined
}

// Bun reports `code: "SQLITE_FULL"`; node:sqlite reports `code: "ERR_SQLITE_ERROR"` with a numeric `errcode`.
function sqliteCode(value: object) {
  const code = "code" in value ? value.code : undefined
  if (typeof code === "string" && code.startsWith("SQLITE_"))
    return TRANSIENT_CODES.some((prefix) => code === prefix || code.startsWith(`${prefix}_`))
  const errcode = "errcode" in value ? value.errcode : undefined
  if (code === "ERR_SQLITE_ERROR" && typeof errcode === "number") return TRANSIENT_PRIMARY_CODES.has(errcode & 0xff)
  return undefined
}
