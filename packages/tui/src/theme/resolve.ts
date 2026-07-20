import { RGBA } from "@opentui/core"
import { ansiToRgba } from "./color"
import type { ColorValue, Theme, ThemeColor, ThemeJson } from "./v1"

export function resolveThemeColors(
  theme: ThemeJson,
  mode: "dark" | "light",
  resolveAnsi: (code: number) => RGBA = ansiToRgba,
) {
  const defs = theme.defs ?? {}
  function resolveColor(color: ColorValue, chain: string[] = []): RGBA {
    if (color instanceof RGBA) return color
    if (typeof color === "string") {
      if (color === "transparent" || color === "none") return RGBA.fromInts(0, 0, 0, 0)

      if (color.startsWith("#")) return RGBA.fromHex(color)

      if (chain.includes(color)) {
        throw new Error(`Circular color reference: ${[...chain, color].join(" -> ")}`)
      }

      const next = defs[color] ?? theme.theme[color as ThemeColor]
      if (next === undefined) {
        throw new Error(`Color reference "${color}" not found in defs or theme`)
      }
      return resolveColor(next, [...chain, color])
    }
    if (typeof color === "number") return resolveAnsi(color)
    return resolveColor(color[mode], chain)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => [key, resolveColor(value as ColorValue)]),
  ) as Partial<Record<ThemeColor, RGBA>>

  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  return {
    theme: {
      ...(resolved as Record<ThemeColor, RGBA>),
      selectedListItemText: hasSelectedListItemText
        ? resolveColor(theme.theme.selectedListItemText!)
        : resolved.background!,
      backgroundMenu:
        theme.theme.backgroundMenu === undefined ? resolved.backgroundElement! : resolveColor(theme.theme.backgroundMenu),
    } satisfies Omit<Theme, "_hasSelectedListItemText" | "thinkingOpacity">,
    hasSelectedListItemText,
    thinkingOpacity: theme.theme.thinkingOpacity ?? 0.6,
  }
}
