import type { DesktopTheme, ResolvedTheme, ResolvedV2Theme } from "./types"
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

export async function loadThemeFromUrl(url: string): Promise<DesktopTheme> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load theme from ${url}: ${response.statusText}`)
  }
  return response.json()
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
