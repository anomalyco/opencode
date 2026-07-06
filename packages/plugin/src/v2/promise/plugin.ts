import type { PluginApi } from "@opencode-ai/client/promise/api"
import type { PluginContext } from "./context.js"

export interface Plugin {
  readonly id: string
  readonly setup: (context: PluginContext) => Promise<void> | void
}

export function define(plugin: Plugin) {
  return plugin
}

export interface PluginDomain extends PluginApi {}
