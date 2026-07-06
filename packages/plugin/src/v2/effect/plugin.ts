import type { PluginApi } from "@opencode-ai/client/effect/api"
import type { Effect, Scope } from "effect"
import type { PluginContext } from "./context.js"

export interface Plugin<R = Scope.Scope> {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R>
}

export function define<R = Scope.Scope>(plugin: Plugin<R>) {
  return plugin
}

export interface PluginDomain extends PluginApi<unknown> {}
