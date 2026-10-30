import { randomUUID } from "node:crypto"
import { hostname } from "node:os"
import { Schema } from "effect"

/** A filesystem database has one execution process, regardless of the client's XDG profile. */
export const DATABASE_OWNER_TABLE = "_opencode_execution_owner"

const Record = Schema.Struct({
  version: Schema.Literal(1),
  token: Schema.NonEmptyString,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  host: Schema.NonEmptyString,
  refs: Schema.Int.check(Schema.isGreaterThan(0)),
})
export type DatabaseOwner = typeof Record.Type
const decode = Schema.decodeUnknownSync(Record)
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Record))

export function parseDatabaseOwner(value: unknown): DatabaseOwner {
  return decode(value)
}

export function parseDatabaseOwnerJson(value: string): DatabaseOwner {
  return decodeJson(value)
}

// workerd imports this module too and forbids global-scope random operations. Materialize only on use.
let token: string | undefined
let host: string | undefined
export const databaseOwnerIdentity = {
  get token() {
    return (token ??= randomUUID())
  },
  get pid() {
    return process.pid
  },
  get host() {
    return (host ??= hostname())
  },
}

export function ownsDatabase(owner: DatabaseOwner) {
  return (
    owner.token === databaseOwnerIdentity.token &&
    owner.pid === process.pid &&
    owner.host === databaseOwnerIdentity.host
  )
}

export function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // Only ESRCH proves death. EPERM and unknown failures must not authorize a takeover.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") return false
    return true
  }
}

export function databaseOwnerAlive(
  owner: DatabaseOwner,
  local = { host: databaseOwnerIdentity.host, exists: processExists },
) {
  // There is no safe remote-host death check here. Never expire a live owner by wall-clock age.
  return owner.host !== local.host || local.exists(owner.pid)
}

export class DatabaseOwnedError extends Error {
  override readonly name = "DatabaseOwnedError"
  constructor(readonly owner: DatabaseOwner) {
    super(
      `Database is already owned by opencode pid ${owner.pid} on ${owner.host}. ` +
        "Connect to that server with --server <url>, or use a different OPENCODE_DB. " +
        "Refusing to start a second execution process.",
    )
  }
}
