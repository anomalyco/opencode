export * as SdkPlugins from "./sdk"

import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"

export const Updated = EventV2.ephemeral({ type: "sdk.plugin.updated", schema: {} })

export interface Store {
  readonly plugins: Map<string, Plugin>
}

export const makeStore = (): Store => ({ plugins: new Map() })

const defaultStore = makeStore()

/**
 * Holds the plugins an embedder (the `@opencode-ai/sdk-next` host) contributes,
 * so `PluginSupervisor` can add them on every Location boot through the ordinary
 * generation path that `PluginSupervisor` uses for plugins discovered from
 * config. Registration publishes an unlocated update so every booted Location
 * reloads its plugin generation from the shared store.
 *
 * The store is shared explicitly between the SDK construction graph and the
 * embedded route graph because `LocationServiceMap` builds Location layers lazily
 * in a nested graph. Each embedded SDK creates its own store, so instances do not
 * see each other's contributions.
 */
export interface Interface {
  readonly register: (plugin: Plugin) => Effect.Effect<void>
  readonly all: () => readonly Plugin[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SdkPlugins") {}

export const layerWithStore = (store: Store) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          store.plugins.clear()
        }),
      )
      return Service.of({
        register: (plugin) =>
          Effect.sync(() => {
            store.plugins.set(plugin.id, plugin)
          }).pipe(Effect.andThen(events.publish(Updated, {})), Effect.asVoid),
        all: () => [...store.plugins.values()],
      })
    }),
  )

export const layer = layerWithStore(defaultStore)

export const node = makeGlobalNode({ service: Service, layer, deps: [EventV2.node] })
