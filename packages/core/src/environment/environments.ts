export * as Environments from "./environments.js"

import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { Machines } from "../machine/machines.js"
import { Workspace } from "../workspace.js"
import { Environment } from "./index.js"

export interface Interface {
  /**
   * Total lookup for any environment ID: local, a paired machine, or a workspace sandbox.
   * Returns a failing handle when a machine was removed instead of falling back to the host.
   * Never boots a Location and never holds a workspace lease longer than one operation.
   */
  readonly get: (id: Environment.ID) => Effect.Effect<Environment.Interface>
  /**
   * Strict lookup for an environment ID typed by a user or model.
   * Fails immediately with NotFound when a machine or workspace does not exist, without waking lazy sandboxes.
   */
  readonly lookup: (id: Environment.ID) => Effect.Effect<Environment.Interface, Machines.NotFound | Workspace.NotFound>
  /** Whether an environment prefix is known (local, any workspace ID, or a registered paired machine). */
  readonly has: (id: Environment.ID) => Effect.Effect<boolean>
  /** Whether an environment is currently reachable in memory without waking a cold/lazy sandbox. */
  readonly ready: (id: Environment.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environments") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const machines = yield* Machines.Service
    const workspaces = yield* Workspace.Service
    const local = Environment.local(spawner)

    const sandbox = Effect.fnUntraced(function* (id: Workspace.ID) {
      // Workspace.connect builds a lazy per-operation driver without waking or provisioning here.
      const driver = yield* workspaces.connect(id).pipe(Effect.orDie)
      return Environment.workspace(id, driver)
    })

    return Service.of({
      get: Effect.fn("Environments.get")(function* (id: Environment.ID) {
        if (id === Environment.localID) return local
        if (Workspace.isID(id)) return yield* sandbox(id)
        return yield* machines
          .get(id)
          .pipe(Effect.catchTag("Machines.NotFound", (error) => Effect.succeed(Environment.unavailable(id, error))))
      }),
      lookup: Effect.fn("Environments.lookup")(function* (id: Environment.ID) {
        if (id === Environment.localID) return local
        if (Workspace.isID(id)) {
          if (!(yield* workspaces.exists(id))) return yield* new Workspace.NotFound({ workspaceID: id })
          return yield* sandbox(id)
        }
        return yield* machines.get(id)
      }),
      has: Effect.fn("Environments.has")(function* (id: Environment.ID) {
        if (id === Environment.localID || Workspace.isID(id)) return true
        return (yield* machines.list()).some((info) => info.id === id)
      }),
      ready: Effect.fn("Environments.ready")(function* (id: Environment.ID) {
        if (id === Environment.localID) return true
        if (Workspace.isID(id)) return yield* workspaces.connected(id)
        return true
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [CrossSpawnSpawner.node, Machines.node, Workspace.node],
})
