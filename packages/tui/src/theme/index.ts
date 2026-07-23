import { resolveThemeColors } from "./resolve"
import { DEFAULT_THEMES, type Theme, type ThemeV1Json } from "./v1"
import { decodeThemeFile } from "./v2/resolve"
import type { ThemeFile } from "./v2/schema"
import { migrateV1 } from "./v2/v1-migrate"

export { DEFAULT_THEMES, generateSyntax, selectedForeground, type Theme, type ThemeV1Json } from "./v1"

export type ThemeDocument = ThemeV1Json | ThemeFile

const pluginThemes: Record<string, ThemeDocument> = {}
let customThemes: Record<string, ThemeDocument> = {}
let systemTheme: ThemeDocument | undefined
const listeners = new Set<(themes: Record<string, ThemeDocument>) => void>()
const normalized = new WeakMap<object, ThemeFile>()

function listThemes() {
  // Priority: defaults < plugin installs < custom files < generated system.
  const themes: Record<string, ThemeDocument> = {
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

export function isTheme(theme: unknown): theme is ThemeDocument {
  if (!isRecord(theme)) return false
  const version = themeVersion(theme)
  if (version === 2) return true
  if (version !== 1) return false
  return isRecord(theme.theme)
}

export function normalizeTheme(theme: ThemeDocument, name = "theme") {
  const cached = normalized.get(theme)
  if (cached) return cached
  const version = themeVersion(theme)
  if (version !== 1 && version !== 2) throw new Error(`Unsupported theme version: ${String(version)}`)
  const file = version === 1 ? migrateV1(theme as ThemeV1Json) : decodeThemeFile(theme, name)
  normalized.set(theme, file)
  return file
}

export function subscribeThemes(listener: (themes: Record<string, ThemeDocument>) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCustomThemes(themes: Record<string, unknown>) {
  customThemes = Object.fromEntries(
    Object.entries(themes).filter((entry): entry is [string, ThemeDocument] => isTheme(entry[1])),
  )
  for (const theme of Object.values(customThemes)) normalized.delete(theme)
  syncThemes()
}

export function setSystemTheme(theme: ThemeDocument | undefined) {
  if (theme) normalized.delete(theme)
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
  normalized.delete(theme)
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  normalized.delete(theme)
  if (customThemes[name] !== undefined) {
    customThemes[name] = theme
  } else {
    pluginThemes[name] = theme
  }
  syncThemes()
  return true
}

export function resolveTheme(theme: ThemeV1Json, mode: "dark" | "light"): Theme {
  const resolved = resolveThemeColors(theme, mode)
  return {
    ...resolved.theme,
    _hasSelectedListItemText: resolved.hasSelectedListItemText,
    thinkingOpacity: resolved.thinkingOpacity,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function themeVersion(theme: object) {
  return "version" in theme ? theme.version : 1
}
