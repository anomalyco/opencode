import type { RGBA } from "@opentui/core"
import type { PromptBarState } from "./prompt-bar-state"
import type { PromptBarVisualTheme } from "./prompt-bar-visual"

export type PromptBarAnimationInput = {
  state: PromptBarState
  hasContent: boolean
  idleCycleIndex: number
  idleCycleEnabled: boolean
  theme: PromptBarVisualTheme
}

export type PromptBarAnimationPlugin = {
  id: string
  label: string
  interval_ms: number
  resolve(input: PromptBarAnimationInput): RGBA | undefined
}
