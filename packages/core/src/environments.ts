export * as Environments from "./environments.js"

import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
// The leaf, not the Environment barrel: the barrel's Location node stands on this registry.
import { EnvironmentService } from "./environment/environment.js"
import type { Machine } from "./machine/index.js"
import { Machines } from "./machine/machines.js"
import { Workspace } from "./workspace.js"
import type { WorkspaceDriver } from "./workspace/driver.js"

export interface Interface {
  /**
   * The environment an ID names: this server's own, a machine's, or a workspace's. Generated workspace IDs (`wrk_…`)
   * contain `_` and never match a machine name; a custom `wrk…` workspace ID falls through after checking machines.
   * A workspace connects lazily: its calls wake it.
   */
  readonly get: (
    id: EnvironmentService.ID,
  ) => Effect.Effect<
    EnvironmentService.Interface,
    Machines.NotFound | Workspace.NotFound | WorkspaceDriver.Error | WorkspaceDriver.ProviderNotFound
  >
  /** The home directory: this server's, or a machine's from its live hello. No other environment has one here. */
  readonly home: (id: EnvironmentService.ID) => Effect.Effect<string, Machines.NotFound | Machine.NotSent>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environments") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const local = EnvironmentService.local(yield* ChildProcessSpawner)
    const machines = yield* Machines.Service
    const workspace = yield* Workspace.Service

    return Service.of({
      get: Effect.fn("Environments.get")(function* (id) {
        if (id === EnvironmentService.localID) return local
        return yield* machines.get(id).pipe(
          Effect.catchTag("Machines.NotFound", (error) =>
            Effect.gen(function* () {
              if (!Schema.is(Workspace.ID)(id)) return yield* error
              // A workspace runs ripgrep through its own spawner. Nothing of the server's reaches it otherwise.
              return EnvironmentService.make(id, yield* workspace.connect(id), { searchable: true })
            }),
          ),
        )
      }),
      home: (id) => (id === EnvironmentService.localID ? Effect.succeed(Global.Path.home) : machines.home(id)),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Machines.node, Workspace.node],
})
