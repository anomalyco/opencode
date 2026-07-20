import { resolveThemeColors } from "./resolve"
import { DEFAULT_THEMES, type Theme, type ThemeJson } from "./v1"

export { DEFAULT_THEMES, generateSyntax, selectedForeground, type Theme, type ThemeJson } from "./v1"

const pluginThemes: Record<string, ThemeJson> = {}
let customThemes: Record<string, ThemeJson> = {}
let systemTheme: ThemeJson | undefined
const listeners = new Set<(themes: Record<string, ThemeJson>) => void>()

function listThemes() {
  // Priority: defaults < plugin installs < custom files < generated system.
  const themes = {
    ...DEFAULT_THEMES,
    ...pluginThemes,
    ...customThemes,
  }
  if (!systemTheme) return themes
  return {
    ...themes,
    system: systemTheme,
  }
}

function syncThemes() {
  const themes = listThemes()
  for (const listener of listeners) listener(themes)
}

export function allThemes() {
  return listThemes()
}

export function isTheme(theme: unknown): theme is ThemeJson {
  if (typeof theme !== "object" || theme === null || Array.isArray(theme)) return false
  const value = Reflect.get(theme, "theme")
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function subscribeThemes(listener: (themes: Record<string, ThemeJson>) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCustomThemes(themes: Record<string, ThemeJson>) {
  customThemes = themes
  syncThemes()
}

export function setSystemTheme(theme: ThemeJson | undefined) {
  systemTheme = theme
  syncThemes()
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (hasTheme(name)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (customThemes[name] !== undefined) {
    customThemes[name] = theme
  } else {
    pluginThemes[name] = theme
  }
  syncThemes()
  return true
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light"): Theme {
  const resolved = resolveThemeColors(theme, mode)
  return {
    ...resolved.theme,
    _hasSelectedListItemText: resolved.hasSelectedListItemText,
    thinkingOpacity: resolved.thinkingOpacity,
  }
}
