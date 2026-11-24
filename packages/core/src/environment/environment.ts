import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode/util/effect/app-node"
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

/** What an environment says about itself, set by whoever makes it. Absent means no, or the server's own. */
export interface Facts {
  /** The path rules of its files, when they are not the server's. */
  readonly path?: PlatformPath
  /** The shell every command there runs under, when it is not the configured one. */
  readonly shell?: string
  /**
   * Whether this is the computer the server itself runs on, so a command there is the server's own child: it starts
   * from the server's variables, its cwd is made absolute here, the server's process daemon can hold it, and the
   * server's formatters reach its files.
   */
  readonly hostsServer?: boolean
  /** Whether a search can run over its files. It goes when the search tools no longer need a ripgrep binary there. */
  readonly searchable?: boolean
}

export interface Interface extends Facts {
  readonly id: ID
  readonly files: Files
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

export const make = (id: ID, driver: Driver, facts?: Facts): Interface => ({
  ...facts,
  id,
  files: makeFiles(driver),
  spawner: driver.spawner,
})

/** The computer the server runs on. */
export const local = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  make(
    localID,
    makeLocalDriver(spawner),
    // Runtimes without local process execution (such as workerd) cannot host local commands or search.
    spawner === EnvironmentUnavailable.spawner ? {} : { hostsServer: true, searchable: true },
  )

/** A workspace sandbox environment; runs ripgrep through its own spawner and uses POSIX path rules. */
export const workspace = (id: Workspace.ID, driver: Driver) =>
  make(ID.make(id), driver, { path: posix, searchable: true })

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
