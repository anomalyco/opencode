import { RGBA } from "@opentui/core"

/**
 * Default opencode theme colors for use before the theme context is available.
 * These match the "opencode" theme which is the default theme.
 */
export const DEFAULT_COLORS = {
  dark: {
    background: RGBA.fromHex("#0a0a0a"),
    text: RGBA.fromHex("#eeeeee"),
    textMuted: RGBA.fromHex("#808080"),
    primary: RGBA.fromHex("#fab283"),
  },
  light: {
    background: RGBA.fromHex("#ffffff"),
    text: RGBA.fromHex("#1a1a1a"),
    textMuted: RGBA.fromHex("#8a8a8a"),
    primary: RGBA.fromHex("#3b7dd8"),
  },
} as const

export type Mode = "dark" | "light"

export function getDefaultColors(mode: Mode) {
  return DEFAULT_COLORS[mode]
}
