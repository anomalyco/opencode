import type { DesktopTheme, ResolvedTheme } from "./types"
import { resolveThemeVariant, themeToCss } from "./resolve"

let activeTheme: DesktopTheme | null = null
let active: string | null = null
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
  active = themeId ?? theme.id
  const lightTokens = resolveThemeVariant(theme.light, false)
  const darkTokens = resolveThemeVariant(theme.dark, true)
  const css = buildThemeCss(lightTokens, darkTokens)
  const themeStyleElement = ensureLoaderStyleElement()
  themeStyleElement.textContent = css
}

function buildThemeCss(light: ResolvedTheme, dark: ResolvedTheme): string {
  const lightCss = themeToCss(light)
  const darkCss = themeToCss(dark)

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

export async function loadThemeFromUrl(url: string): Promise<DesktopTheme> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load theme from ${url}: ${response.statusText}`)
  }
  return response.json()
}

export function getActiveTheme(): DesktopTheme | null {
  if (!active) {
    return null
  }
  if (activeTheme?.id === active) {
    return activeTheme
  }
  return null
}

export function removeTheme(): void {
  activeTheme = null
  active = null
  const existingElement = document.getElementById(THEME_STYLE_ID)
  if (existingElement) {
    existingElement.remove()
  }
}

export function setColorScheme(scheme: "light" | "dark" | "auto"): void {
  if (scheme === "auto") {
    document.documentElement.style.removeProperty("color-scheme")
  } else {
    document.documentElement.style.setProperty("color-scheme", scheme)
  }
}
