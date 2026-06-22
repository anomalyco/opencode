import type { Effect, Scope } from "effect"
import type { PluginHost } from "./host.js"

export interface Plugin<R = never> {
  readonly id: string
  readonly effect: (host: PluginHost) => Effect.Effect<void, never, R | Scope.Scope>
}

export function define<R>(plugin: Plugin<R>) {
  return plugin
}
