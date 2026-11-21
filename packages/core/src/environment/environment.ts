import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { Driver } from "./driver.js"
import type { Files } from "./files.js"
import { makeFiles } from "./exec-defaults.js"
import { makeLocalDriver } from "./local.js"
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

export interface Interface {
  readonly id: ID
  readonly files: Files
  readonly spawner: ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

export const make = (id: ID, driver: Driver): Interface => ({ id, files: makeFiles(driver), spawner: driver.spawner })

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
    const driver = location.workspaceID
      ? yield* workspace.connect(location.workspaceID).pipe(
          // Environment has no error channel; an unknown or destroyed placement is a configuration defect by design.
          Effect.mapError(
            (cause) => new Error(`Failed to bind Environment to workspace ${location.workspaceID}`, { cause }),
          ),
          Effect.orDie,
        )
      : makeLocalDriver(spawner)
    return Service.of(make(location.workspaceID ? ID.make(location.workspaceID) : localID, driver))
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Location.node, Workspace.node],
})

export * as EnvironmentService from "./environment.js"
