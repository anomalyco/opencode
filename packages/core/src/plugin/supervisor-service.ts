export * as PluginSupervisor from "./supervisor-service.js"

import { Context, Effect } from "effect"
import { Plugin } from "@opencode-ai/schema/plugin"

/**
 * Dependency-only supervisor seam. Keep this module free of implementation
 * imports: the supervisor reaches PluginRuntime, which depends on Session.
 */
export interface Interface {
  /** Wait for the initial plugin generation and startup updates to settle. */
  readonly flush: Effect.Effect<void>
  readonly check: () => Effect.Effect<Plugin.UpdateInfo[]>
  readonly update: (name: string) => Effect.Effect<Plugin.UpdateResult>
  readonly updateAll: () => Effect.Effect<Plugin.UpdateResult[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}

export const noUpdates = {
  check: () => Effect.succeed([]),
  update: () => Effect.die("Plugin updates unavailable"),
  updateAll: () => Effect.succeed([]),
} satisfies Omit<Interface, "flush">
