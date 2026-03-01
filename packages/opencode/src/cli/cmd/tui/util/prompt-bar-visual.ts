import type { RGBA } from "@opentui/core"
import type { PromptBarState } from "./prompt-bar-state"

export type PromptBarVisualTheme = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  info: RGBA
  success: RGBA
  warning: RGBA
  error: RGBA
}

export type PromptBarOverlayInput = {
  state: PromptBarState
  hasContent: boolean
  idleCycleIndex: number
  idleCycleEnabled: boolean
  theme: PromptBarVisualTheme
}

const IDLE_CYCLE_PALETTE = [
  "primary",
  "secondary",
  "accent",
  "info",
  "success",
  "warning",
] as const

export function resolvePromptBarOverlay({
  state,
  hasContent,
  idleCycleIndex,
  idleCycleEnabled,
  theme,
}: PromptBarOverlayInput): RGBA | undefined {
  if (state !== "idle") {
    switch (state) {
      case "error":
        return theme.error
      case "warning":
        return theme.warning
      case "tool_running":
        return theme.info
      case "streaming":
        return theme.primary
      case "tool_result":
        return theme.success
      case "assistant_final":
        return theme.secondary
      default:
        return undefined
    }
  }

  if (hasContent) return theme.secondary
  if (!idleCycleEnabled) return undefined

  const paletteKey = IDLE_CYCLE_PALETTE[idleCycleIndex % IDLE_CYCLE_PALETTE.length]
  return theme[paletteKey]
}
