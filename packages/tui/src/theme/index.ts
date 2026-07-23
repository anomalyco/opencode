import { Schema } from "effect"
import { resolveThemeColors } from "./resolve"
import { DEFAULT_THEMES, type Theme, type ThemeV1Json } from "./v1"
import { resolveThemeDocument, themeDecodeError } from "./v2/resolve"
import { ThemeDocument } from "./v2/schema"
import { migrateV1 } from "./v2/v1-migrate"

export { DEFAULT_THEMES, generateSyntax, selectedForeground, type Theme, type ThemeV1Json } from "./v1"
export { resolveThemeDocument, type ThemeDocument }

const pluginThemes: Record<string, unknown> = {}
let customThemes: Record<string, unknown> = {}
let systemTheme: unknown
const listeners = new Set<(themes: Record<string, unknown>) => void>()
const parsed = new WeakMap<object, ThemeDocument>()
const decodeThemeDocument = Schema.decodeUnknownSync(ThemeDocument)

function listThemes() {
  // Priority: defaults < plugin installs < custom files < generated system.
  const themes: Record<string, unknown> = {
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

export function isThemeSource(source: unknown) {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return false
  return "theme" in source || "version" in source
}

export function parseTheme(source: unknown, name = "theme") {
  const object = typeof source === "object" && source !== null ? source : undefined
  const cached = object ? parsed.get(object) : undefined
  if (cached) return cached

  const version = (source as { version?: unknown } | null)?.version ?? 1
  const document =
    version === 1
      ? migrateV1(source as ThemeV1Json)
      : version === 2
        ? decodeV2Theme(source, name)
        : unsupportedThemeVersion(version)

  if (object) parsed.set(object, document)
  return document
}

export function subscribeThemes(listener: (themes: Record<string, unknown>) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCustomThemes(themes: Record<string, unknown>) {
  customThemes = Object.fromEntries(Object.entries(themes).filter((entry) => isThemeSource(entry[1])))
  syncThemes()
}

export function setSystemTheme(theme: unknown) {
  systemTheme = theme
  syncThemes()
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isThemeSource(theme)) return false
  if (hasTheme(name)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isThemeSource(theme)) return false
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

function decodeV2Theme(source: unknown, name: string) {
  try {
    return decodeThemeDocument(source)
  } catch (error) {
    throw themeDecodeError(error, name)
  }
}

function unsupportedThemeVersion(version: unknown): never {
  throw new Error(`Unsupported theme version: ${String(version)}`)
}
