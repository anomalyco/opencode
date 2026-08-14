import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { Files } from "./files.js"
import { makeFiles } from "./index.js"
import { makeLocalDriver } from "./local.js"
import { Location } from "../location.js"
import { Workspace } from "../workspace.js"

export interface Interface {
  readonly files: Files
  readonly spawner: ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

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
    return Service.of({ files: makeFiles(driver), spawner: driver.spawner })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Location.node, Workspace.node],
})

export * as EnvironmentService from "./environment.js"
