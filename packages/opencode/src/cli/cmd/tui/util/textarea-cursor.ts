import { RGBA, type CursorStyle, type CursorStyleOptions } from "@opentui/core"
import type { TuiConfig } from "@/config/tui"

type CursorConfig = TuiConfig.Info

type CursorTheme = {
  text: RGBA
  [key: string]: unknown
}

export function resolveTextareaCursor(theme: CursorTheme, tui?: CursorConfig, fallbackColor: RGBA = theme.text): {
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

function resolveCursorColor(theme: CursorTheme, color?: string): RGBA | undefined {
  if (!color) return
  if (color.startsWith("#")) return RGBA.fromHex(color)
  const maybeThemeColor = theme[color]
  if (maybeThemeColor instanceof RGBA) return maybeThemeColor
}
