export * as ServerWorkspaceDrivers from "./drivers"

import { Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { ModalDriver } from "./modal"

/** Replaces core's empty default registry in Server composition. */
export const node = makeGlobalNode({
  service: WorkspaceDriver.RegistryService,
  layer: Layer.effect(
    WorkspaceDriver.RegistryService,
    Effect.map(ModalDriver.make, (modal) =>
      WorkspaceDriver.RegistryService.of(WorkspaceDriver.registry({ modal })),
    ),
  ),
  deps: [],
})
