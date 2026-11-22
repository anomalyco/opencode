import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Environment } from "@opencode/schema/environment"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { PlatformPath } from "node:path"
import type { Driver } from "./driver.js"
import type { Files } from "./files.js"
import { makeFiles } from "./exec-defaults.js"
import { makeLocalDriver } from "./local.js"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import { Workspace } from "../workspace.js"

// The wire and storage contract lives in Schema; these keep the domain facade's identity unchanged.
export const ID = Environment.ID
export type ID = typeof ID.Type

/** The server's own machine. */
export const localID = Environment.localID

/** Where a file or a directory is: an absolute path in an environment. */
export const Place = Environment.Place
export type Place = Environment.Place

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
  readonly spawner: ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

export const make = (id: ID, driver: Driver, facts?: Facts): Interface => ({
  ...facts,
  id,
  files: makeFiles(driver),
  spawner: driver.spawner,
})

/** The computer the server runs on. */
export const local = (spawner: ChildProcessSpawner["Service"]) =>
  make(localID, makeLocalDriver(spawner), { hostsServer: true, searchable: true })

/**
 * A session's own working directory, already bound to its environment, set by the runner around a step.
 * Read per operation: absent unless the session names one, so a bare path or command stays the Location's directory.
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

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const location = yield* Location.Service
    const workspace = yield* Workspace.Service
    if (!location.workspaceID) return Service.of(local(spawner))
    const driver = yield* workspace.connect(location.workspaceID).pipe(
      // Environment has no error channel; an unknown or destroyed placement is a configuration defect by design.
      Effect.mapError(
        (cause) => new Error(`Failed to bind Environment to workspace ${location.workspaceID}`, { cause }),
      ),
      Effect.orDie,
    )
    // A workspace runs ripgrep through its own spawner. Nothing of the server's reaches it otherwise.
    return Service.of(make(ID.make(location.workspaceID), driver, { searchable: true }))
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Location.node, Workspace.node],
})

export * as EnvironmentService from "./environment.js"
