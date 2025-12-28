/**
 * Theme context for SolidJS applications.
 * Provides reactive theme management with localStorage persistence and caching.
 *
 * Works in conjunction with the preload script to provide zero-FOUC theming:
 * 1. Preload script applies cached CSS immediately from localStorage
 * 2. ThemeProvider takes over, resolves theme, and updates cache
 */

import {
  createContext,
  useContext,
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  type JSX,
  type Accessor,
} from "solid-js"
import type { DesktopTheme } from "./types"
import { resolveThemeVariant, themeToCss } from "./resolve"
import { STORAGE_KEYS, getThemeCacheKey } from "./preload"
import { DEFAULT_THEMES } from "./default-themes"

export type ColorScheme = "light" | "dark" | "system"

interface ThemeContextValue {
  /** Currently active theme ID */
  themeId: Accessor<string>
  /** Current color scheme preference */
  colorScheme: Accessor<ColorScheme>
  /** Resolved current mode (light or dark) */
  mode: Accessor<"light" | "dark">
  /** All available themes */
  themes: Accessor<Record<string, DesktopTheme>>
  /** Set the active theme by ID */
  setTheme: (id: string) => void
  /** Set color scheme preference */
  setColorScheme: (scheme: ColorScheme) => void
  /** Register a custom theme */
  registerTheme: (theme: DesktopTheme) => void
}

const ThemeContext = createContext<ThemeContextValue>()

/**
 * Static tokens that don't change between themes
 */
const STATIC_TOKENS = `
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
  --letter-spacing-tight: -0.16;
  --letter-spacing-tightest: -0.32;
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
  --shadow-xs: 0 1px 2px -1px rgba(19, 16, 16, 0.04), 0 1px 2px 0 rgba(19, 16, 16, 0.06), 0 1px 3px 0 rgba(19, 16, 16, 0.08);
  --shadow-md: 0 6px 8px -4px rgba(19, 16, 16, 0.12), 0 4px 3px -2px rgba(19, 16, 16, 0.12), 0 1px 2px -1px rgba(19, 16, 16, 0.12);
  --shadow-xs-border: 0 0 0 1px var(--border-base), 0 1px 2px -1px rgba(19, 16, 16, 0.04), 0 1px 2px 0 rgba(19, 16, 16, 0.06), 0 1px 3px 0 rgba(19, 16, 16, 0.08);
  --shadow-xs-border-base: 0 0 0 1px var(--border-weak-base), 0 1px 2px -1px rgba(19, 16, 16, 0.04), 0 1px 2px 0 rgba(19, 16, 16, 0.06), 0 1px 3px 0 rgba(19, 16, 16, 0.08);
  --shadow-xs-border-select: 0 0 0 3px var(--border-weak-selected), 0 0 0 1px var(--border-selected), 0 1px 2px -1px rgba(19, 16, 16, 0.25), 0 1px 2px 0 rgba(19, 16, 16, 0.08), 0 1px 3px 0 rgba(19, 16, 16, 0.12);
  --shadow-xs-border-focus: 0 0 0 1px var(--border-base), 0 1px 2px -1px rgba(19, 16, 16, 0.25), 0 1px 2px 0 rgba(19, 16, 16, 0.08), 0 1px 3px 0 rgba(19, 16, 16, 0.12), 0 0 0 2px var(--background-weak), 0 0 0 3px var(--border-selected);
`

const THEME_STYLE_ID = "oc-theme"

function ensureThemeStyleElement(): HTMLStyleElement {
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
 * Resolve a mode from system preference
 */
function getSystemMode(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/**
 * Apply theme CSS to the document
 */
function applyThemeCss(theme: DesktopTheme, themeId: string, mode: "light" | "dark"): void {
  const isDark = mode === "dark"
  const variant = isDark ? theme.dark : theme.light
  const tokens = resolveThemeVariant(variant, isDark)
  const css = themeToCss(tokens)

  // Cache to localStorage for preload script
  const cacheKey = getThemeCacheKey(themeId, mode)
  try {
    localStorage.setItem(cacheKey, css)
  } catch {
    // localStorage might be full or disabled
  }

  // Build full CSS
  const fullCss = `:root {
  ${STATIC_TOKENS}
  color-scheme: ${mode};
  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
  ${css}
}`

  // Remove preload style if it exists
  const preloadStyle = document.getElementById("oc-theme-preload")
  if (preloadStyle) {
    preloadStyle.remove()
  }

  const themeStyleElement = ensureThemeStyleElement()
  themeStyleElement.textContent = fullCss

  // Update data attributes
  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
}

/**
 * Cache both light and dark variants of a theme
 */
function cacheThemeVariants(theme: DesktopTheme, themeId: string): void {
  for (const mode of ["light", "dark"] as const) {
    const isDark = mode === "dark"
    const variant = isDark ? theme.dark : theme.light
    const tokens = resolveThemeVariant(variant, isDark)
    const css = themeToCss(tokens)
    const cacheKey = getThemeCacheKey(themeId, mode)
    try {
      localStorage.setItem(cacheKey, css)
    } catch {
      // localStorage might be full or disabled
    }
  }
}

export function ThemeProvider(props: { children: JSX.Element; defaultTheme?: string }) {
  const [themes, setThemes] = createSignal<Record<string, DesktopTheme>>(DEFAULT_THEMES)
  const [themeId, setThemeIdSignal] = createSignal(props.defaultTheme ?? "oc-1")
  const [colorScheme, setColorSchemeSignal] = createSignal<ColorScheme>("system")
  const [mode, setMode] = createSignal<"light" | "dark">(getSystemMode())

  // Listen for system color scheme changes
  onMount(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      if (colorScheme() === "system") {
        setMode(getSystemMode())
      }
    }
    mediaQuery.addEventListener("change", handler)
    onCleanup(() => mediaQuery.removeEventListener("change", handler))

    // Load saved preferences
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME_ID)
    const savedScheme = localStorage.getItem(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null

    if (savedTheme && themes()[savedTheme]) {
      setThemeIdSignal(savedTheme)
    }

    if (savedScheme) {
      setColorSchemeSignal(savedScheme)
      if (savedScheme !== "system") {
        setMode(savedScheme)
      }
    }

    // Cache current theme variants for future preloads
    const currentTheme = themes()[themeId()]
    if (currentTheme) {
      cacheThemeVariants(currentTheme, themeId())
    }
  })

  // Apply theme when themeId or mode changes
  createEffect(() => {
    const id = themeId()
    const m = mode()
    const theme = themes()[id]
    if (theme) {
      applyThemeCss(theme, id, m)
    }
  })

  const setTheme = (id: string) => {
    const theme = themes()[id]
    if (!theme) {
      console.warn(`Theme "${id}" not found`)
      return
    }

    setThemeIdSignal(id)
    localStorage.setItem(STORAGE_KEYS.THEME_ID, id)

    // Cache both variants for future preloads
    cacheThemeVariants(theme, id)
  }

  const setColorSchemePref = (scheme: ColorScheme) => {
    setColorSchemeSignal(scheme)
    localStorage.setItem(STORAGE_KEYS.COLOR_SCHEME, scheme)

    if (scheme === "system") {
      setMode(getSystemMode())
    } else {
      setMode(scheme)
    }
  }

  const registerTheme = (theme: DesktopTheme) => {
    setThemes((prev) => ({
      ...prev,
      [theme.id]: theme,
    }))
  }

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        colorScheme,
        mode,
        themes,
        setTheme,
        setColorScheme: setColorSchemePref,
        registerTheme,
      }}
    >
      {props.children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return ctx
}
