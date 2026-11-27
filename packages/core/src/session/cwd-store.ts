export * as SessionCwdStore from "./cwd-store.js"

import { eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import type { Database } from "../database/database.js"
import { Environment } from "../environment/index.js"
import type { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"

// Experimental storage inside session_v2.metadata so this stays internal with zero DB migration.
// Stripped from public Session.Info.metadata and preserved across MetadataUpdated.
const metadataKey = "$opencode_experimental_cwd"
const decodePlace = Schema.decodeUnknownOption(Environment.Place)

export function readStored(metadata: SessionSchema.Metadata | null | undefined): {
  readonly cwd: Environment.Place | undefined
  readonly metadata: SessionSchema.Metadata | undefined
} {
  if (!metadata) return { cwd: undefined, metadata: undefined }
  if (!Object.hasOwn(metadata, metadataKey)) return { cwd: undefined, metadata }
  const cwd = Option.getOrUndefined(decodePlace(metadata[metadataKey]))
  const rest = Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== metadataKey))
  return { cwd, metadata: Object.keys(rest).length > 0 ? rest : undefined }
}

export function writeStored(
  metadata: SessionSchema.Metadata | null | undefined,
  cwd: Environment.Place | undefined,
): SessionSchema.Metadata | null {
  if (!cwd && (!metadata || !Object.hasOwn(metadata, metadataKey))) return metadata ?? null
  const clean = Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => key !== metadataKey))
  const next = cwd ? { ...clean, [metadataKey]: cwd } : clean
  return Object.keys(next).length > 0 ? next : null
}

export const read = Effect.fn("SessionCwd.read")(function* (db: Database.Interface["db"], sessionID: SessionSchema.ID) {
  const row = yield* db
    .select({ metadata: SessionTable.metadata })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  return readStored(row?.metadata).cwd
})

export const write = Effect.fn("SessionCwd.write")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  cwd: Environment.Place | undefined,
) {
  const row = yield* db
    .select({ metadata: SessionTable.metadata })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  const existing = readStored(row.metadata)
  if (existing.cwd?.absolute === cwd?.absolute && existing.cwd?.environment.id === cwd?.environment.id) return
  yield* db
    .update(SessionTable)
    .set({ metadata: writeStored(row.metadata, cwd) })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
})
