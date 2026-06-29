export * as SdkPlugins from "./sdk"

import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"

/**
 * Holds the plugins an embedder (the `@opencode-ai/sdk-next` host) contributes,
 * so `PluginInternal` can add them on every Location boot through the ordinary
 * `ctx.plugin.add` seam — the same path `ConfigExternalPlugin` uses for plugins
 * discovered from config. A plugin registered after a Location has booted only
 * applies to Locations booted afterward, matching config-plugin timing;
 * embedders register at startup before creating Sessions.
 *
 * State lives in this global-node service (like `ApplicationTools`) rather than
 * module scope, so the list belongs to one embedded instance and is disposed
 * with it instead of leaking across `OpenCode.create` calls.
 */
export interface Interface {
  readonly register: (plugin: Plugin) => Effect.Effect<void>
  readonly all: () => readonly Plugin[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SdkPlugins") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const plugins: Plugin[] = []
    return Service.of({
      register: (plugin) => Effect.sync(() => void plugins.push(plugin)),
      all: () => plugins,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
