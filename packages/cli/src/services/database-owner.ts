import { existsSync, readFileSync } from "node:fs"
import {
  DATABASE_OWNER_TABLE,
  DatabaseOwnedError,
  databaseOwnerAlive,
  databaseOwnerIdentity,
  parseDatabaseOwnerJson,
} from "@opencode/util/database-owner"
import { Service } from "@opencode/client/effect/service"
import { Option, Schema } from "effect"

const decodeRegistration = Schema.decodeUnknownOption(Schema.fromJsonString(Service.Info))

/** Early diagnostic only; the core database lease remains authoritative against races and other entrypoints. */
export async function checkDatabaseOwner(file: string, registration: string) {
  if (file === ":memory:" || !existsSync(file)) return
  const { Database } = await import("bun:sqlite")
  const db = new Database(file, { readonly: true })
  try {
    db.run("PRAGMA busy_timeout = 2000")
    if (!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(DATABASE_OWNER_TABLE)) return
    const row = db.query<{ value: string }, []>("SELECT value FROM _opencode_execution_owner WHERE id = 1").get()
    if (!row) return
    const owner = parseDatabaseOwnerJson(row.value)
    if (!databaseOwnerAlive(owner)) return
    // A registered service may still be starting. Let normal service resolution wait for it.
    const registered = existsSync(registration) ? decodeRegistration(readFileSync(registration, "utf8")) : Option.none()
    if (owner.host === databaseOwnerIdentity.host && Option.isSome(registered) && registered.value.pid === owner.pid)
      return
    throw new DatabaseOwnedError(owner)
  } finally {
    db.close()
  }
}
