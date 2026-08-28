export * as SessionInstance from "./instance.js"

import { Context, Effect, Layer, RcMap } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import type { Instance } from "../instance.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"
import { SessionModelTransport } from "./model-transport.js"
import { SessionSchema } from "./schema.js"

/** Selects capabilities without owning Session admission or execution coordination. */
export interface Interface {
  readonly get: (session: SessionSchema.Info) => Layer.Layer<Instance.Services, Instance.Error>
  readonly check: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly closeTransport: (session: SessionSchema.Info) => Effect.Effect<void>
  readonly destination: (ref: Location.Ref) => Layer.Layer<Location.Service, Instance.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionInstance") {}

/** The server keeps sharing a graph for each canonical Location. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return Service.of({
      get: (session) => locations.get(session.location),
      check: () => Effect.void,
      destination: (ref) => locations.get(ref),
      closeTransport: Effect.fn("SessionInstance.closeTransport")(function* (session) {
        const ref = Location.Ref.make({
          directory: session.location.directory,
          workspaceID: session.location.workspaceID,
        })
        if (!(yield* RcMap.has(locations.rcMap, ref))) return
        yield* SessionModelTransport.Service.use((transport) => transport.close(session.id)).pipe(
          Effect.provide(locations.get(ref)),
        )
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [LocationServiceMap.node] })
