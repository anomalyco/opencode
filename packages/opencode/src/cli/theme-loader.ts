/**
 * Theme loader for CLI - loads theme JSON files and converts to MarkdownTheme format
 */
import type { MarkdownTheme } from "./markdown-renderer"
import opencode from "./cmd/tui/context/theme/opencode.json" with { type: "json" }
import aura from "./cmd/tui/context/theme/aura.json" with { type: "json" }
import ayu from "./cmd/tui/context/theme/ayu.json" with { type: "json" }
import catppuccin from "./cmd/tui/context/theme/catppuccin.json" with { type: "json" }
import catppuccinFrappe from "./cmd/tui/context/theme/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./cmd/tui/context/theme/catppuccin-macchiato.json" with { type: "json" }
import dracula from "./cmd/tui/context/theme/dracula.json" with { type: "json" }
import github from "./cmd/tui/context/theme/github.json" with { type: "json" }
import gruvbox from "./cmd/tui/context/theme/gruvbox.json" with { type: "json" }
import nord from "./cmd/tui/context/theme/nord.json" with { type: "json" }
import tokyonight from "./cmd/tui/context/theme/tokyonight.json" with { type: "json" }
import vercel from "./cmd/tui/context/theme/vercel.json" with { type: "json" }

const THEMES: Record<string, any> = {
  opencode,
  aura,
  ayu,
  catppuccin,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-macchiato": catppuccinMacchiato,
  dracula,
  github,
  gruvbox,
  nord,
  tokyonight,
  vercel,
}

type ColorValue = string | { dark: string; light: string }

/**
 * Resolve a color value from theme defs
 */
function resolveColor(value: ColorValue, defs: Record<string, string>, mode: "dark" | "light"): string {
  if (typeof value === "string") {
    // Check if it's a reference to a def
    return defs[value] || value
  }
  // Mode-specific color
  const colorKey = mode === "dark" ? value.dark : value.light
  return defs[colorKey] || colorKey
}

/**
 * Convert hex color to RGBA format (0-1 floats)
 */
function hexToRGBA(hex: string): { r: number; g: number; b: number; a: number } {
  const cleaned = hex.replace("#", "")
  const r = Number.parseInt(cleaned.substring(0, 2), 16) / 255
  const g = Number.parseInt(cleaned.substring(2, 4), 16) / 255
  const b = Number.parseInt(cleaned.substring(4, 6), 16) / 255
  return { r, g, b, a: 1.0 }
}

/**
 * Load a theme by name and convert to MarkdownTheme format
 */
export function loadTheme(themeName?: string, mode: "dark" | "light" = "dark"): MarkdownTheme {
  const themeData = THEMES[themeName || "opencode"] || THEMES.opencode
  const defs = themeData.defs || {}
  const theme = themeData.theme || {}

  const resolve = (key: string) => {
    const value = theme[key]
    if (!value) return { r: 1, g: 1, b: 1, a: 1 } // Default white
    const hex = resolveColor(value, defs, mode)
    return hexToRGBA(hex)
  }

  return {
    text: resolve("text"),
    textMuted: resolve("textMuted"),
    accent: resolve("accent"),
    primary: resolve("primary"),
    border: resolve("border"),
    background: resolve("background"),
    backgroundPanel: resolve("backgroundPanel"),
    backgroundElement: resolve("backgroundElement"),
    markdownText: resolve("markdownText"),
    markdownHeading: resolve("markdownHeading"),
    markdownLink: resolve("markdownLink"),
    markdownLinkText: resolve("markdownLinkText"),
    markdownCode: resolve("markdownCode"),
    markdownCodeBlock: resolve("markdownCodeBlock"),
    markdownBlockQuote: resolve("markdownBlockQuote"),
    markdownEmph: resolve("markdownEmph"),
    markdownStrong: resolve("markdownStrong"),
    markdownListItem: resolve("markdownListItem"),
    markdownListEnumeration: resolve("markdownListEnumeration"),
    markdownHorizontalRule: resolve("markdownHorizontalRule"),
    diffAdded: resolve("diffAdded"),
    diffRemoved: resolve("diffRemoved"),
  }
}
