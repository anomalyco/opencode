export * as WorkspaceConnector from "./workspace-connector.js"

import type { Workspace } from "@opencode/schema/workspace"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { type Driver, EnvironmentDriver } from "./driver.js"

export interface Interface {
  /** A per-operation driver for a workspace sandbox; never wakes or provisions it here. */
  readonly connect: (workspaceID: Workspace.ID) => Effect.Effect<Driver>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkspaceConnector") {}

/**
 * Default fail-closed connector for hosts and tests without workspaces: every operation in a workspace
 * placement fails instead of reaching the server host. Hosts with workspaces replace this node with
 * `Workspace.connectorNode`.
 */
export const node = makeGlobalNode({
  service: Service,
  layer: Layer.succeed(
    Service,
    Service.of({
      connect: (workspaceID) => {
        const message = `This host has no workspaces to connect ${workspaceID}`
        return Effect.succeed(
          EnvironmentDriver.lazy(Effect.fail(new Error(message)), {
            module: "WorkspaceConnector",
            spawnDescription: message,
          }),
        )
      },
    }),
  ),
  deps: [],
})
