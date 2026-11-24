export * as SessionCwd from "./cwd.js"

import { Effect, Option } from "effect"
import { Database } from "../database/database.js"
import { Environments } from "../environment/environments.js"
import { Environment } from "../environment/index.js"
import { EnvironmentPath } from "../environment/path.js"
import { FileAccess } from "../file-access.js"
import { Flag } from "../flag.js"
import type { AbsolutePath } from "../schema.js"
import { read, readStored, write, writeStored } from "./cwd-store.js"
import { CwdError } from "./error.js"
import type { SessionSchema } from "./schema.js"

export { read, readStored, write, writeStored }

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

/**
 * Experimental: resolves a typed cwd string in this Location (local path, paired machine, or sandbox path)
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
