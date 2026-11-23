export * as SessionCwd from "./cwd.js"

import { eq } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Database } from "../database/database.js"
import { Environments } from "../environment/environments.js"
import { Environment } from "../environment/index.js"
import { EnvironmentPath } from "../environment/path.js"
import { FileAccess } from "../file-access.js"
import { Flag } from "../flag.js"
import { AbsolutePath } from "../schema.js"
import { CwdError } from "./error.js"
import type { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"

// Experimental storage inside session_v2.metadata so this stays internal with zero DB migration.
// Stripped from public Session.Info.metadata and preserved across MetadataUpdated.
const metadataKey = "$opencode_experimental_cwd"
const decodePlace = Schema.decodeUnknownOption(Environment.Place)

/** A session cwd bound to its environment: where it is, and the files and commands it resolves against. */
export interface Resolved {
  readonly absolute: AbsolutePath
  readonly environment: Environment.Interface
}

/** A path in a cwd's environment as the model writes it: plain on the Location's own environment, `machine:/path` elsewhere. */
export const format = (cwd: Resolved, path: string, locationEnvironmentID: Environment.ID) =>
  cwd.environment.id === locationEnvironmentID ? path : EnvironmentPath.format(cwd.environment.id, path)

/** The cwd as the model writes it, naming the machine when the directory is on a paired machine. */
export const describe = (cwd: Resolved, locationEnvironmentID: Environment.ID) => ({
  path: format(cwd, cwd.absolute, locationEnvironmentID),
  machine: cwd.environment.id === locationEnvironmentID ? undefined : cwd.environment.id,
})

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

/**
 * Experimental: resolves a typed cwd string in this Location (local path or paired machine path)
 * and verifies that the target exists and is a directory.
 */
export const locate = Effect.fn("SessionCwd.locate")(function* (text: string) {
  const access = yield* FileAccess.Service
  const target = yield* access.resolve({ path: text, kind: "directory" })
  const invalid = (message: string) => new CwdError({ cwd: text, message })
  const type = yield* Environment.typeFollowing(target.environment.files, target.absolute).pipe(
    Effect.catchTag("Environment.NotFound", () => Effect.fail(invalid(`Working directory does not exist: ${text}`))),
    Effect.catchTag("Environment.Failed", () => Effect.fail(invalid(`Unable to read working directory: ${text}`))),
  )
  if (type !== "directory") return yield* invalid(`Working directory is not a directory: ${text}`)
  return { absolute: target.absolute, environment: { id: target.environment.id } } satisfies Environment.Place
})

/**
 * Build once in a Location layer (or call `SessionCwd.current` directly where Location services are in context).
 * Resolves a session's stored cwd to its bound environment when the `machines` flag is on.
 */
export const make = Effect.gen(function* () {
  const database = Option.getOrUndefined(yield* Effect.serviceOption(Database.Service))
  const flags = Option.getOrUndefined(yield* Effect.serviceOption(Flag.Service))
  const environment = Option.getOrUndefined(yield* Effect.serviceOption(Environment.Service))
  const environments = Option.getOrUndefined(yield* Effect.serviceOption(Environments.Service))

  const resolve = Effect.fn("SessionCwd.current")(function* (sessionID: SessionSchema.ID) {
    if (!database || !flags || !environment) return undefined
    if (!(yield* flags.enabled("machines"))) return undefined
    const cwd = yield* read(database.db, sessionID)
    if (!cwd) return undefined
    if (cwd.environment.id === environment.id) return { absolute: cwd.absolute, environment }
    if (!environments) return undefined
    return { absolute: cwd.absolute, environment: yield* environments.get(cwd.environment.id) }
  })

  return { current: resolve }
})

export const current = Effect.fn("SessionCwd.current")(function* (sessionID: SessionSchema.ID) {
  const resolver = yield* make
  return yield* resolver.current(sessionID)
})
