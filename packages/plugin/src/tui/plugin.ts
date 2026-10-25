import type { Context } from "./context.js"

export type { Context }

export type Cleanup = () => Promise<void> | void

export interface Definition {
  readonly id: string
  readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void
}

export function define(plugin: Definition) {
  return plugin
}
