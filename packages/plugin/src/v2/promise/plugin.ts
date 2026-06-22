import type { PluginContext } from "./context.js"
import type { PluginDraft, PluginRef } from "../effect/plugin.js"
import type { Hooks } from "./registration.js"

export interface Plugin {
  readonly id: string
  readonly setup: (context: PluginContext) => Promise<void> | void
}

export function define(plugin: Plugin) {
  return plugin
}

export type { PluginDraft, PluginRef }

export type PluginHooks = Hooks<{
  transform: PluginDraft
}>
