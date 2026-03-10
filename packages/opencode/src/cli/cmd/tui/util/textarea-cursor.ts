import { RGBA, type CursorStyle, type CursorStyleOptions } from "@opentui/core"
import type { Config } from "@opencode-ai/sdk/v2"
import type { Theme } from "../context/theme"

type CursorConfig = Config["tui"]

export function resolveTextareaCursor(theme: Theme, tui?: CursorConfig, fallbackColor: RGBA = theme.text): {
  cursorColor: RGBA
  cursorStyle: CursorStyleOptions
} {
  const cursorColor = resolveCursorColor(theme, tui?.cursor_color) ?? fallbackColor
  return {
    cursorColor,
    cursorStyle: {
      style: (tui?.cursor_style ?? "block") as CursorStyle,
      blinking: tui?.cursor_blink ?? true,
    },
  }
}

function resolveCursorColor(theme: Theme, color?: string): RGBA | undefined {
  if (!color) return
  if (color.startsWith("#")) return RGBA.fromHex(color)
  const maybeThemeColor = theme[color as keyof Theme]
  if (maybeThemeColor instanceof RGBA) return maybeThemeColor
}
