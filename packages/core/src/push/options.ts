export * as PushOptions from "./options.js"

import { Context, Effect, Layer } from "effect"
import { AbsolutePath } from "@opencode/schema/schema"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Config } from "../config.js"
import { Flag } from "../flag.js"
import { Location } from "../location.js"
import { LocationServiceMap } from "../location-service-map.js"

export const defaultRelay = "https://opencode-notify-relay.anomalyco.workers.dev"

export interface Options {
  readonly enabled: boolean
  readonly relays: readonly string[]
}

export interface Interface {
  /** Reads the `push` flag and relays from the server's base configuration. */
  readonly get: () => Effect.Effect<Options>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PushOptions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const get = () =>
      Effect.gen(function* () {
        const enabled = yield* Flag.enabled("push")
        const config = yield* Config.Service
        const entries = yield* config.entries()
        const extra = Config.latest(entries, "push")?.relays ?? []
        const relays = [defaultRelay]
        for (const relay of extra) {
          const url = URL.parse(relay)
          if (url?.protocol !== "https:" || relays.includes(url.origin)) continue
          relays.push(url.origin)
        }
        return { enabled, relays } satisfies Options
      }).pipe(
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))),
        Effect.orElseSucceed((): Options => ({ enabled: false, relays: [defaultRelay] })),
      )
    return Service.of({ get })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Global.node, LocationServiceMap.node] })
