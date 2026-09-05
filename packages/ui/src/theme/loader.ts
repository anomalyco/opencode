import type { DesktopTheme, HexColor, ResolvedTheme, ResolvedV2Theme, ThemeVariant } from "./types"
import { resolveThemeVariant, themeToCss } from "./resolve"
import { resolveThemeVariantV2, themeV2ToCss } from "./v2/resolve"

let activeTheme: DesktopTheme | null = null
const THEME_STYLE_ID = "opencode-theme"

function ensureLoaderStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null
  if (existing) {
    return existing
  }
  const element = document.createElement("style")
  element.id = THEME_STYLE_ID
  document.head.appendChild(element)
  return element
}

export function applyTheme(theme: DesktopTheme, themeId?: string): void {
  activeTheme = theme
  const lightTokens = resolveThemeVariant(theme.light, false)
  const darkTokens = resolveThemeVariant(theme.dark, true)
  const lightV2Tokens = resolveThemeVariantV2(theme.light, false)
  const darkV2Tokens = resolveThemeVariantV2(theme.dark, true)
  const targetThemeId = themeId ?? theme.id
  const css = buildThemeCss(lightTokens, darkTokens, lightV2Tokens, darkV2Tokens, targetThemeId)
  const themeStyleElement = ensureLoaderStyleElement()
  themeStyleElement.textContent = css
  document.documentElement.setAttribute("data-theme", targetThemeId)
}

function buildThemeCss(
  light: ResolvedTheme,
  dark: ResolvedTheme,
  lightV2: ResolvedV2Theme,
  darkV2: ResolvedV2Theme,
  themeId: string,
): string {
  const isDefaultTheme = themeId === "oc-2"
  const lightCss = `${themeToCss(light)}\n  ${themeV2ToCss(lightV2)}`
  const darkCss = `${themeToCss(dark)}\n  ${themeV2ToCss(darkV2)}`

  if (isDefaultTheme) {
    return `
:root {
  color-scheme: light;
  --text-mix-blend-mode: multiply;

  ${lightCss}

  @media (prefers-color-scheme: dark) {
    color-scheme: dark;
    --text-mix-blend-mode: plus-lighter;

    ${darkCss}
  }
}
`
  }

  return `
html[data-theme="${themeId}"] {
  color-scheme: light;
  --text-mix-blend-mode: multiply;

  ${lightCss}

  @media (prefers-color-scheme: dark) {
    color-scheme: dark;
    --text-mix-blend-mode: plus-lighter;

    ${darkCss}
  }
}
`
}

export type LoadThemeResult = { ok: true; theme: DesktopTheme } | { ok: false; error: "network" | "invalid" }

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const THEME_ID_PATTERN = /^[a-z0-9-]+$/
const SEED_KEYS = ["neutral", "primary", "success", "warning", "error", "info", "interactive", "diffAdd", "diffDelete"]
const PALETTE_REQUIRED_KEYS = ["neutral", "ink", "primary", "success", "warning", "error", "info"]

function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
}

function isValidVariant(value: unknown): value is ThemeVariant {
  if (typeof value !== "object" || value === null) return false
  const variant = value as Record<string, unknown>
  const hasSeeds = "seeds" in variant
  const hasPalette = "palette" in variant
  if (hasSeeds === hasPalette) return false
  if (hasSeeds) {
    const seeds = variant.seeds
    if (typeof seeds !== "object" || seeds === null) return false
    return SEED_KEYS.every((key) => isHexColor((seeds as Record<string, unknown>)[key]))
  }
  const palette = variant.palette
  if (typeof palette !== "object" || palette === null) return false
  return PALETTE_REQUIRED_KEYS.every((key) => isHexColor((palette as Record<string, unknown>)[key]))
}

/**
 * Structural validation for a DesktopTheme fetched from an untrusted source, mirroring
 * the contract documented in ./desktop-theme.schema.json.
 */
export function isValidDesktopTheme(value: unknown): value is DesktopTheme {
  if (typeof value !== "object" || value === null) return false
  const theme = value as Record<string, unknown>
  if (typeof theme.name !== "string" || theme.name.length === 0) return false
  if (typeof theme.id !== "string" || !THEME_ID_PATTERN.test(theme.id)) return false
  return isValidVariant(theme.light) && isValidVariant(theme.dark)
}

export async function loadThemeFromUrl(url: string): Promise<LoadThemeResult> {
  const response = await fetch(url).catch(() => undefined)
  if (!response || !response.ok) {
    return { ok: false, error: "network" }
  }
  const json = await response.json().catch(() => undefined)
  if (!isValidDesktopTheme(json)) {
    return { ok: false, error: "invalid" }
  }
  return { ok: true, theme: json }
}

export function getActiveTheme(): DesktopTheme | null {
  const activeId = document.documentElement.getAttribute("data-theme")
  if (!activeId) {
    return null
  }
  if (activeTheme?.id === activeId) {
    return activeTheme
  }
  return null
}

export function removeTheme(): void {
  activeTheme = null
  const existingElement = document.getElementById(THEME_STYLE_ID)
  if (existingElement) {
    existingElement.remove()
  }
  document.documentElement.removeAttribute("data-theme")
}

export function setColorScheme(scheme: "light" | "dark" | "auto"): void {
  if (scheme === "auto") {
    document.documentElement.style.removeProperty("color-scheme")
  } else {
    document.documentElement.style.setProperty("color-scheme", scheme)
  }
}
