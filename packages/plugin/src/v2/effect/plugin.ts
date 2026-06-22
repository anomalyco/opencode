import type { Effect, Scope } from "effect"
import type { PluginContext } from "./context.js"
import type { PluginOptions } from "../options.js"
import type { Hooks } from "./registration.js"

export interface Plugin {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, Scope.Scope>
}

export function define(plugin: Plugin) {
  return plugin
}

export interface PluginRef {
  readonly package: string
  readonly options?: PluginOptions
}

export interface PluginDraft {
  list(): readonly Plugin[]
  add(plugin: Plugin): void
  remove(id: string): void
}

export type PluginHooks = Hooks<{
  transform: PluginDraft
}>
