export * as PluginActivation from "./activation.js"

import { Context, type Effect } from "effect"

export type State = {
  active: boolean
  readonly fiberID: number
  readonly token: object
  readonly directory: string
  readonly workspaceID?: string
}

export const Current = Context.Reference<State | undefined>("@opencode/PluginActivation", {
  defaultValue: () => undefined,
})

export const Bridged = Context.Reference<object | undefined>("@opencode/PluginActivation/Bridged", {
  defaultValue: () => undefined,
})

export type PromptPreparation = {
  active: boolean
  readonly fiberID: number
  readonly token: object
  readonly sessionID: string
  readonly wait: Effect.Effect<void>
}

export const PromptPreparationCurrent = Context.Reference<PromptPreparation | undefined>(
  "@opencode/PluginActivation/PromptPreparation",
  { defaultValue: () => undefined },
)

export const PromptPreparationBridged = Context.Reference<object | undefined>(
  "@opencode/PluginActivation/PromptPreparation/Bridged",
  { defaultValue: () => undefined },
)
