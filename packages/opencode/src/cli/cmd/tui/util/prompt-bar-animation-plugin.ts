import type { OptimizedBuffer, RGBA } from "@opentui/core"
import type { PromptBarState } from "./prompt-bar-state"
import type { PromptBarRippleConfig } from "./prompt-bar-ripple"
import type { PromptBarVisualTheme } from "./prompt-bar-visual"

export type PromptBarAnimationInput = {
  state: PromptBarState
  hasContent: boolean
  idleCycleIndex: number
  idleCycleEnabled: boolean
  theme: PromptBarVisualTheme
}

export type PromptBarAnimationRenderInput = {
  buffer: OptimizedBuffer
  data: PromptBarAnimationInput
  ripple: PromptBarRippleConfig
}

export type PromptBarAnimationPlugin = {
  id: string
  label: string
  interval_ms: number
  resolve(input: PromptBarAnimationInput): RGBA | undefined
  render?(input: PromptBarAnimationRenderInput): void
}
