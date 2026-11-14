export * as StorageFailure from "./storage-failure.js"

import { Cause } from "effect"

// SQLite result codes that mean the database itself can't be used, as opposed to a bad statement or a constraint,
// with SQLite's own text for when the driver error has none. BUSY and LOCKED only surface once a write has already
// waited out `busy_timeout`, so the write is lost just like on a full disk.
const codes = {
  SQLITE_BUSY: { primary: 5, reason: "database is locked" },
  SQLITE_LOCKED: { primary: 6, reason: "database table is locked" },
  SQLITE_READONLY: { primary: 8, reason: "attempt to write a readonly database" },
  SQLITE_IOERR: { primary: 10, reason: "disk I/O error" },
  SQLITE_CORRUPT: { primary: 11, reason: "database disk image is malformed" },
  SQLITE_FULL: { primary: 13, reason: "database or disk is full" },
  SQLITE_CANTOPEN: { primary: 14, reason: "unable to open database file" },
  SQLITE_NOTADB: { primary: 26, reason: "file is not a database" },
} as const

type Code = keyof typeof codes
const names = Object.keys(codes) as Code[]

/**
 * The readable message for the storage failure behind an error or a Cause, however deep. A failed query is a query
 * error holding a SqlError holding the driver error, and only the driver error says why.
 */
export function message(error: unknown) {
  const reason = find(error, 0)
  return reason === undefined ? undefined : `Storage error: ${reason}`
}

function find(error: unknown, depth: number): string | undefined {
  // The depth bound also stops a cause chain that loops back on itself.
  if (typeof error !== "object" || error === null || depth > 10) return undefined
  if (Cause.isCause(error))
    return error.reasons
      .map((reason) => {
        if (Cause.isFailReason(reason)) return find(reason.error, depth + 1)
        if (Cause.isDieReason(reason)) return find(reason.defect, depth + 1)
        return undefined
      })
      .find((reason) => reason !== undefined)
  const code = codeOf(error)
  if (!code) return "cause" in error ? find(error.cause, depth + 1) : undefined
  return "message" in error && typeof error.message === "string" && error.message ? error.message : codes[code].reason
}

function codeOf(error: object): Code | undefined {
  if (!("code" in error)) return undefined
  // bun:sqlite reports the result code name, extended ones included (SQLITE_IOERR_WRITE).
  const code = error.code
  if (typeof code === "string" && code.startsWith("SQLITE_"))
    return names.find((name) => code === name || code.startsWith(`${name}_`))
  // node:sqlite reports the numeric code; its low byte is the primary result code.
  if (code === "ERR_SQLITE_ERROR" && "errcode" in error && typeof error.errcode === "number") {
    const primary = error.errcode & 0xff
    return names.find((name) => codes[name].primary === primary)
  }
  return undefined
}
