import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import type { SessionID } from "../schema"
import { SessionRunState } from "../run-state"
import { SessionClosure } from "./coordinator"
import { SessionClosureDiscovery } from "./discovery"
import { SessionClosureHighWater } from "./high-water"
import { SessionClosureIdentity } from "./identity"
import { SessionClosureLineage } from "./lineage"
import { SessionClosureLocation } from "./location"
import { SessionClosureRecord } from "./record"
import { SessionClosureToolPart } from "./toolpart"

export interface Interface {
  readonly request: (
    root: SessionID,
  ) => Effect.Effect<SessionClosure.Outcome, SessionClosure.Failure | SessionClosure.LocationError>
  readonly view: SessionClosure.Interface["view"]
  readonly identity: SessionClosure.Interface["identity"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureRunState") {}

/**
 * Assembles request-borne capabilities that closure cannot depend on directly. Most adapters reach
 * `SessionClosure.node` through `Session` or runtime services, so adding them to the closure graph
 * would create a layer cycle. Keeping all planning capabilities on the request also gives absence
 * one unambiguous meaning instead of introducing fallback services.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const closure = yield* SessionClosure.Service
    const runState = yield* SessionRunState.Service
    const discovery = yield* SessionClosureDiscovery.Service
    const lineage = yield* SessionClosureLineage.Service
    const toolPart = yield* SessionClosureToolPart.Service
    const location = yield* SessionClosureLocation.Service
    const planIdentity = yield* SessionClosureIdentity.Service
    const highWater = yield* SessionClosureHighWater.Service
    const record = yield* SessionClosureRecord.Service
    const capability = {
      assertNotBusy: runState.assertNotBusy,
      cancel: runState.cancel,
    }
    return Service.of({
      request: (root) =>
        closure.request({
          root,
          runState: capability,
          discovery,
          lineage,
          toolPart,
          validateSession: location.validate,
          planIdentity,
          highWater,
          record,
        }),
      view: closure.view,
      identity: closure.identity,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    SessionClosure.node,
    SessionRunState.node,
    SessionClosureDiscovery.node,
    SessionClosureLineage.node,
    SessionClosureToolPart.node,
    SessionClosureLocation.node,
    SessionClosureIdentity.node,
    SessionClosureHighWater.node,
    SessionClosureRecord.node,
  ],
})

export * as SessionClosureRunState from "./run-state"
