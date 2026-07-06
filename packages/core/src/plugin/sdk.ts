export * as SdkPlugins from "./sdk"

import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"

export interface Store {
  readonly plugins: Map<string, Plugin>
}

export const makeStore = (): Store => ({ plugins: new Map() })

const defaultStore = makeStore()

/**
 * Holds the plugins an embedder (the `@opencode-ai/sdk-next` host) contributes,
 * so `PluginSupervisor` can add them on every Location boot through the ordinary
 * generation path that `PluginSupervisor` uses for plugins discovered from
 * config. A plugin registered after a Location has booted only
 * applies to Locations booted afterward, matching config-plugin timing;
 * embedders register at startup before creating Sessions.
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
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          store.plugins.clear()
        }),
      )
      return Service.of({
        register: (plugin) =>
          Effect.sync(() => {
            store.plugins.set(plugin.id, plugin)
          }),
        all: () => [...store.plugins.values()],
      })
    }),
  )

export const layer = layerWithStore(defaultStore)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
