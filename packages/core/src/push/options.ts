export * as PushOptions from "./options.js"

import { Context, Effect, Layer } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Flag } from "../flag.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"

export interface Interface {
  /** Reads the `push` flag from the server's base configuration. */
  readonly enabled: () => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PushOptions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    return Service.of({
      enabled: () =>
        Flag.enabled("push").pipe(
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))),
          Effect.orElseSucceed(() => false),
        ),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Global.node, LocationServiceMap.node] })
