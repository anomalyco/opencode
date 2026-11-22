import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Effect, Layer } from "effect"
import { Environments } from "../environments.js"
import { Location } from "../location.js"
import { ID, localID, Service } from "./environment.js"

/** The Location's environment: its workspace's, or this server's own. */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const environments = yield* Environments.Service
    const environment = yield* environments.get(location.workspaceID ? ID.make(location.workspaceID) : localID).pipe(
      // Environment has no error channel; an unknown or destroyed placement is a configuration defect by design.
      Effect.mapError(
        (cause) => new Error(`Failed to bind Environment to workspace ${location.workspaceID}`, { cause }),
      ),
      Effect.orDie,
    )
    return Service.of(environment)
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node, Environments.node] })

export * as EnvironmentNode from "./node.js"
