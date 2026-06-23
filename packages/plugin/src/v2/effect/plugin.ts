import type { Effect, Scope } from "effect"
import type { PluginContext } from "./context.js"

export interface Plugin {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, Scope.Scope>
}

export function define(plugin: Plugin) {
  return plugin
}

export interface PluginDomain {
  readonly add: (plugin: Plugin) => Effect.Effect<void>
  readonly remove: (id: string) => Effect.Effect<void>
}
