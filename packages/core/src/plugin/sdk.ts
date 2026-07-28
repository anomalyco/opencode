export * as SdkPlugins from "./sdk"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus"
import type { Versioned } from "../plugin"

export const Updated = Bus.ephemeral({ type: "sdk.plugin.updated", schema: {} })

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
  readonly all: () => readonly Versioned[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SdkPlugins") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const plugins = new Map<string, Versioned>()
    let revision = 0
    return Service.of({
      register: (plugin) =>
        Effect.sync(() => {
          plugins.set(plugin.id, { ...plugin, version: String(++revision) })
        }).pipe(Effect.andThen(bus.publish(Updated, {})), Effect.asVoid),
      all: () => [...plugins.values()],
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node] })
