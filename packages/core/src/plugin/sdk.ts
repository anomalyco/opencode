export * as SdkPlugins from "./sdk"

import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"

export const Updated = EventV2.ephemeral({ type: "sdk.plugin.updated", schema: {} })

/**
 * Holds the plugins an embedder (the `@opencode-ai/sdk-next` host) contributes,
 * so `PluginSupervisor` can add them on every Location boot through the ordinary
 * generation path that `PluginSupervisor` uses for plugins discovered from
 * config. Registration publishes an unlocated update so every booted Location
 * reloads its plugin generation from the shared store.
 *
 * Each host-global layer owns one private store. Location graphs reuse that
 * layer through Effect's memoization, so separate hosts remain isolated while
 * every Location in one host sees the same registrations.
 */
export interface Interface {
  readonly register: (plugin: Plugin) => Effect.Effect<void>
  readonly all: () => readonly Plugin[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SdkPlugins") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const plugins = new Map<string, Plugin>()
    return Service.of({
      register: (plugin) =>
        Effect.sync(() => {
          plugins.set(plugin.id, plugin)
        }).pipe(Effect.andThen(events.publish(Updated, {})), Effect.asVoid),
      all: () => [...plugins.values()],
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [EventV2.node] })
