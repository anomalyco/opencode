/**
 * Theme loader - loads theme JSON files and applies them to the DOM.
 */

import type { DesktopTheme, ResolvedTheme } from "./types"
import { resolveThemeVariant, themeToCss } from "./resolve"

/** Currently active theme */
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

/**
 * Load and apply a theme to the document.
 * Creates or updates a <style> element with the theme's CSS custom properties.
 *
 * @param theme - The desktop theme to apply
 * @param themeId - Optional theme ID for the data-theme attribute
 */
export function applyTheme(theme: DesktopTheme, themeId?: string): void {
  activeTheme = theme

  // Resolve both variants
  const lightTokens = resolveThemeVariant(theme.light, false)
  const darkTokens = resolveThemeVariant(theme.dark, true)

  const targetThemeId = themeId ?? theme.id

  // Build the CSS
  const css = buildThemeCss(lightTokens, darkTokens, targetThemeId)

  const themeStyleElement = ensureLoaderStyleElement()
  themeStyleElement.textContent = css

  document.documentElement.setAttribute("data-theme", targetThemeId)
}

/**
 * Build CSS string from resolved theme tokens
 */
function buildThemeCss(light: ResolvedTheme, dark: ResolvedTheme, themeId: string): string {
  const isDefaultTheme = themeId === "oc-1"

  // Static tokens that don't change between themes
  const staticTokens = `
  --font-family-sans: "Inter", "Inter Fallback";
  --font-family-sans--font-feature-settings: "ss03" 1;
  --font-family-mono: "IBM Plex Mono", "IBM Plex Mono Fallback";
  --font-family-mono--font-feature-settings: "ss01" 1;

  --font-size-small: 13px;
  --font-size-base: 14px;
  --font-size-large: 16px;
  --font-size-x-large: 20px;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --line-height-large: 150%;
  --line-height-x-large: 180%;
  --line-height-2x-large: 200%;
  --letter-spacing-normal: 0;
  --letter-spacing-tight: -0.1599999964237213;
  --letter-spacing-tightest: -0.3199999928474426;
  --paragraph-spacing-base: 0;

  --spacing: 0.25rem;

  --breakpoint-sm: 40rem;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 64rem;
  --breakpoint-xl: 80rem;
  --breakpoint-2xl: 96rem;

  --container-3xs: 16rem;
  --container-2xs: 18rem;
  --container-xs: 20rem;
  --container-sm: 24rem;
  --container-md: 28rem;
  --container-lg: 32rem;
  --container-xl: 36rem;
  --container-2xl: 42rem;
  --container-3xl: 48rem;
  --container-4xl: 56rem;
  --container-5xl: 64rem;
  --container-6xl: 72rem;
  --container-7xl: 80rem;

  --radius-xs: 0.125rem;
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.625rem;

  --shadow-xs:
    0 1px 2px -1px rgba(19, 16, 16, 0.04), 0 1px 2px 0 rgba(19, 16, 16, 0.06), 0 1px 3px 0 rgba(19, 16, 16, 0.08);
  --shadow-md:
    0 6px 8px -4px rgba(19, 16, 16, 0.12), 0 4px 3px -2px rgba(19, 16, 16, 0.12), 0 1px 2px -1px rgba(19, 16, 16, 0.12);
  --shadow-xs-border:
    0 0 0 1px var(--border-base, rgba(11, 6, 0, 0.2)), 0 1px 2px -1px rgba(19, 16, 16, 0.04),
    0 1px 2px 0 rgba(19, 16, 16, 0.06), 0 1px 3px 0 rgba(19, 16, 16, 0.08);
  --shadow-xs-border-base:
    0 0 0 1px var(--border-weak-base, rgba(17, 0, 0, 0.12)), 0 1px 2px -1px rgba(19, 16, 16, 0.04),
    0 1px 2px 0 rgba(19, 16, 16, 0.06), 0 1px 3px 0 rgba(19, 16, 16, 0.08);
  --shadow-xs-border-select:
    0 0 0 3px var(--border-weak-selected, rgba(1, 103, 255, 0.29)),
    0 0 0 1px var(--border-selected, rgba(0, 74, 255, 0.99)), 0 1px 2px -1px rgba(19, 16, 16, 0.25),
    0 1px 2px 0 rgba(19, 16, 16, 0.08), 0 1px 3px 0 rgba(19, 16, 16, 0.12);
  --shadow-xs-border-focus:
    0 0 0 1px var(--border-base, rgba(11, 6, 0, 0.2)), 0 1px 2px -1px rgba(19, 16, 16, 0.25),
    0 1px 2px 0 rgba(19, 16, 16, 0.08), 0 1px 3px 0 rgba(19, 16, 16, 0.12), 0 0 0 2px var(--background-weak, #f1f0f0),
    0 0 0 3px var(--border-selected, rgba(0, 74, 255, 0.99));`

  const lightCss = themeToCss(light)
  const darkCss = themeToCss(dark)

  // For the default theme, we use :root directly
  // For named themes, we use the [data-theme] selector
  if (isDefaultTheme) {
    return `
:root {
  ${staticTokens}

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
  ${staticTokens}

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

/**
 * Load a theme from a JSON file URL
 */
export async function loadThemeFromUrl(url: string): Promise<DesktopTheme> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load theme from ${url}: ${response.statusText}`)
  }
  return response.json()
}

/**
 * Get the currently active theme
 */
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

/**
 * Remove the current theme and clean up
 */
export function removeTheme(): void {
  activeTheme = null
  const existingElement = document.getElementById(THEME_STYLE_ID)
  if (existingElement) {
    existingElement.remove()
  }
  document.documentElement.removeAttribute("data-theme")
}

/**
 * Force a specific color scheme (light/dark) regardless of system preference
 */
export function setColorScheme(scheme: "light" | "dark" | "auto"): void {
  if (scheme === "auto") {
    document.documentElement.style.removeProperty("color-scheme")
  } else {
    document.documentElement.style.setProperty("color-scheme", scheme)
  }
}
