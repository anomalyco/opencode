export * as WorkflowCoordinator from "./coordinator"

import { Context, Effect, Layer, Schema } from "effect"
import { Location } from "../location"
import { Workflow } from "../workflow"
import { makeGlobalNode } from "../effect/app-node"

export const StartInput = Schema.Struct({
  workflowID: Workflow.ID,
  location: Location.Ref,
}).annotate({ identifier: "WorkflowCoordinator.StartInput" })
export interface StartInput extends Schema.Schema.Type<typeof StartInput> {}

export interface Interface {
  readonly start: (input: StartInput) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/WorkflowCoordinator") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    start: () => Effect.void,
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

