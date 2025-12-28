import type { DesktopTheme, ResolvedTheme } from "./types"
import { resolveThemeVariant, themeToCss } from "./resolve"

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
  const targetThemeId = themeId ?? theme.id
  const css = buildThemeCss(lightTokens, darkTokens, targetThemeId)
  const themeStyleElement = ensureLoaderStyleElement()
  themeStyleElement.textContent = css
  document.documentElement.setAttribute("data-theme", targetThemeId)
}

function buildThemeCss(light: ResolvedTheme, dark: ResolvedTheme, themeId: string): string {
  const isDefaultTheme = themeId === "oc-1"
  const lightCss = themeToCss(light)
  const darkCss = themeToCss(dark)

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
