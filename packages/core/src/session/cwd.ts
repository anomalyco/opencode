export * as SessionCwd from "./cwd.js"

import { Effect, PlatformError } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { posix } from "node:path"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import type { Flag } from "../flag.js"
import { Machines } from "../machine/machines.js"
import { CwdError } from "./error.js"
import type { SessionSchema } from "./schema.js"

/**
 * Experimental: reads what someone typed as a Session cwd in this Location. A machine path names that machine, a
 * relative path is the Location's directory, and the directory must already exist there.
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
 * Experimental: the Session's cwd bound to its environment, or undefined when it has none, the machines flag is off,
 * or the machine it names is gone. Its services are passed in because its callers hold them at build time.
 */
export const current = (input: {
  readonly session: SessionSchema.Info
  /** Absent where the caller holds no Location services, such as a fixture: the cwd then cannot be placed. */
  readonly flag?: Flag.Interface
  readonly environment?: Environment.Interface
  /** Absent where machines are not configured; a cwd on a paired machine then means nothing. */
  readonly machines?: Machines.Interface
}): Effect.Effect<
  { readonly absolute: Environment.Place["absolute"]; readonly environment: Environment.Interface } | undefined
> =>
  Effect.gen(function* () {
    const cwd = input.session.experimental?.cwd
    if (!cwd || !input.flag || !input.environment) return undefined
    if (!(yield* input.flag.enabled("machines"))) return undefined
    if (cwd.environment.id === input.environment.id) return { absolute: cwd.absolute, environment: input.environment }
    if (!input.machines) return undefined
    const machine = yield* input.machines
      .get(cwd.environment.id)
      .pipe(Effect.catchTag("Machines.NotFound", (error) => Effect.succeed(missingMachine(cwd.environment.id, error))))
    return { absolute: cwd.absolute, environment: machine }
  })

// A session whose cwd names a removed machine must fail loudly rather than silently falling back to this server.
const missingMachine = (id: Environment.ID, error: Machines.NotFound): Environment.Interface => {
  const spawner = ChildProcessSpawner.make(() =>
    Effect.fail(
      PlatformError.systemError({
        _tag: "Unknown",
        module: "Machine",
        method: "spawn",
        description: error.message,
        cause: error,
      }),
    ),
  )
  const fail = (path: string) => Effect.fail(new Environment.Failed({ path, cause: error }))
  return Environment.make(
    id,
    {
      spawner,
      overrides: {
        read: (path) => fail(path),
        write: (path) => fail(path),
        stat: (path) => fail(path),
        list: (path) => fail(path),
        remove: (path) => fail(path),
        move: (from) => fail(from),
        mkdir: (path) => fail(path),
        append: (path) => fail(path),
      },
    },
    { path: posix, shell: "sh" },
  )
}
