import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, PlatformError, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { posix, type PlatformPath } from "node:path"
import type { Driver } from "./driver.js"
import { Failed, type Files } from "./files.js"
import { makeFiles } from "./exec-defaults.js"
import { makeLocalDriver } from "./local.js"
import { EnvironmentUnavailable } from "./unavailable.js"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import { Workspace } from "../workspace.js"

// An environment's name: what a path will later use to say where it lives.
export const ID = Schema.String.pipe(Schema.brand("Environment.ID"))
export type ID = typeof ID.Type

/** The server's own machine. */
export const localID = ID.make("local")

/** Where a file or a directory is: an absolute path in an environment. */
export const Place = Schema.Struct({
  absolute: AbsolutePath,
  environment: Schema.Struct({ id: ID }),
})
export type Place = typeof Place.Type

/** Target properties supplied by whoever constructs an Environment. */
export interface Options {
  /**
   * True only when commands and files live on the server's own OS process (false on workerd and all remotes):
   * commands start from the server's variables, cwds resolve here, the process daemon can hold them, and host
   * formatters and worktree strategies reach its files.
   */
  readonly local?: boolean
  /** The path rules of its files, when they are not the server's. */
  readonly path?: PlatformPath
  /** The shell every command there runs under, when it is not the configured one. */
  readonly shell?: string
  /** Resolves `~` in this environment when available (host homedir locally, `hello.home` on paired machines). */
  readonly home?: Effect.Effect<string, unknown>
  /**
   * Ripgrep command to spawn in this environment (`undefined` means search is unavailable).
   * Local environments (`local: true`) use the bundled `RipgrepBinary` when `rg` is set.
   */
  readonly rg?: Effect.Effect<string, unknown>
}

export interface Interface extends Options {
  readonly id: ID
  readonly local: boolean
  readonly files: Files
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

export const make = (id: ID, driver: Driver, options?: Options): Interface => ({
  ...options,
  id,
  local: options?.local === true,
  files: makeFiles(driver),
  spawner: driver.spawner,
})

/** The computer the server runs on. */
export const local = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  make(
    localID,
    makeLocalDriver(spawner),
    // Runtimes without local process execution (such as workerd) cannot host local commands or search.
    spawner === EnvironmentUnavailable.spawner
      ? {}
      : { local: true, home: Effect.sync(() => Global.Path.home), rg: Effect.succeed("rg") },
  )

/** A workspace sandbox environment; runs ripgrep through its own spawner and uses POSIX path rules. */
export const workspace = (id: Workspace.ID, driver: Driver) =>
  make(ID.make(id), driver, { path: posix, rg: Effect.succeed("rg") })

/**
 * A total environment handle that fails every file and command operation loudly with `cause` instead of
 * silently falling back to the server host.
 */
export const unavailable = (id: ID, cause: Error): Interface => {
  const spawner = ChildProcessSpawner.make(() =>
    Effect.fail(
      PlatformError.systemError({
        _tag: "Unknown",
        module: "Environment",
        method: "spawn",
        description: cause.message,
        cause,
      }),
    ),
  )
  const fail = (path: string) => Effect.fail(new Failed({ path, cause }))
  return make(
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

/**
 * A session's own working directory, bound to its environment, provided by the runner around a step.
 * Absent unless the session sets one, so bare paths and commands stay on the Location's directory.
 */
export const CurrentWorkingDirectory = Context.Reference<
  { readonly absolute: AbsolutePath; readonly environment: Interface } | undefined
>("@opencode/Environment/CurrentWorkingDirectory", { defaultValue: () => undefined })

/** The place of a path or a command that names no directory: the Location's directory, in its environment. */
export const workingDirectory = Effect.gen(function* () {
  const location = yield* Location.Service
  const environment = yield* Service
  return { absolute: location.directory, environment }
})

/** Build once inside a Location layer; resolves CurrentWorkingDirectory per call, falling back to the Location's default. */
export const workingDirectoryResolver = Effect.map(workingDirectory, (fallback) =>
  Effect.gen(function* () {
    return (yield* CurrentWorkingDirectory) ?? fallback
  }),
)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const location = yield* Location.Service
    const workspaces = yield* Workspace.Service
    if (!location.workspaceID) return Service.of(local(spawner))
    const driver = yield* workspaces.connect(location.workspaceID).pipe(
      // Environment has no error channel; an unknown or destroyed placement is a configuration defect by design.
      Effect.mapError(
        (cause) => new Error(`Failed to bind Environment to workspace ${location.workspaceID}`, { cause }),
      ),
      Effect.orDie,
    )
    return Service.of(workspace(location.workspaceID, driver))
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Location.node, Workspace.node],
})

export * as EnvironmentService from "./environment.js"
