export * as Plugin from "./service.js"

// The service tag lives apart from the layer so one-shot embedders can wait on activation without
// importing the plugin host, which itself depends on Session.
import { Plugin } from "@opencode/schema/plugin"
import type { Plugin as PluginDefinition } from "@opencode/plugin/effect/plugin"
import { Context, type Effect, type Exit } from "effect"

export interface Interface {
  readonly activate: (plugins: readonly Generation[], failures?: readonly Failure[]) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Plugin.Info[]>
  /** An active plugin's prebuilt `./gui-experimental` bundle, or undefined when it exports none. */
  readonly gui: (id: Plugin.ID) => Effect.Effect<Plugin.GuiBundle | undefined>
  readonly close: (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
  /** Wait for announced updates and activation to settle; failures remain in the inventory. */
  readonly awaitActivation: Effect.Effect<void>
  /** Whether activation has settled, without waiting for it. */
  readonly activated: Effect.Effect<boolean>
  /** Keep readiness pending while preparing an update. Run the returned Effect to release it. */
  readonly hold: () => Effect.Effect<Effect.Effect<void>>
}

export type Failure = Plugin.Info & { readonly state: Extract<Plugin.State, { readonly status: "failed" }> }

export type Generation = PluginDefinition & {
  readonly revision: string
  readonly source?: Plugin.Source
  readonly features?: Plugin.Features
  /**
   * The package's `./gui-experimental` bundle: its file URL, the plugin's options, and an opaque revision that changes
   * with the plugin, its options or the bundle's content. A change to the bundle alone reloads it in the app without
   * restarting the server entry.
   */
  readonly gui?: { readonly file: string; readonly revision: string; readonly options: Plugin.GuiBundle["options"] }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

/**
 * Wait for announced updates and activation to settle. Shared server paths never call this; one-shot
 * embedders may use it with a deadline before reading plugin-provided state.
 */
export const awaitActivation = Service.use((plugins) => plugins.awaitActivation)
