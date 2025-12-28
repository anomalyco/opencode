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
import { DEFAULT_THEMES } from "./default-themes"

export type ColorScheme = "light" | "dark" | "system"

interface ThemeContextValue {
  themeId: Accessor<string>
  colorScheme: Accessor<ColorScheme>
  mode: Accessor<"light" | "dark">
  themes: Accessor<Record<string, DesktopTheme>>
  setTheme: (id: string) => void
  setColorScheme: (scheme: ColorScheme) => void
  registerTheme: (theme: DesktopTheme) => void
  previewTheme: (id: string) => void
  previewColorScheme: (scheme: ColorScheme) => void
  commitPreview: () => void
  cancelPreview: () => void
}

const ThemeContext = createContext<ThemeContextValue>()

const STORAGE_KEYS = {
  THEME_ID: "opencode-theme-id",
  COLOR_SCHEME: "opencode-color-scheme",
  THEME_CSS_PREFIX: "opencode-theme-css",
} as const

function getThemeCacheKey(themeId: string, mode: "light" | "dark"): string {
  return `${STORAGE_KEYS.THEME_CSS_PREFIX}-${themeId}-${mode}`
}

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

function getSystemMode(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyThemeCss(theme: DesktopTheme, themeId: string, mode: "light" | "dark"): void {
  const isDark = mode === "dark"
  const variant = isDark ? theme.dark : theme.light
  const tokens = resolveThemeVariant(variant, isDark)
  const css = themeToCss(tokens)

  if (themeId !== "oc-1") {
    const cacheKey = getThemeCacheKey(themeId, mode)
    try {
      localStorage.setItem(cacheKey, css)
    } catch {}
  }

  const fullCss = `:root {
  color-scheme: ${mode};
  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
  ${css}
}`

  const preloadStyle = document.getElementById("oc-theme-preload")
  if (preloadStyle) {
    preloadStyle.remove()
  }

  const themeStyleElement = ensureThemeStyleElement()
  themeStyleElement.textContent = fullCss

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
}

function cacheThemeVariants(theme: DesktopTheme, themeId: string): void {
  if (themeId === "oc-1") return

  for (const mode of ["light", "dark"] as const) {
    const isDark = mode === "dark"
    const variant = isDark ? theme.dark : theme.light
    const tokens = resolveThemeVariant(variant, isDark)
    const css = themeToCss(tokens)
    const cacheKey = getThemeCacheKey(themeId, mode)
    try {
      localStorage.setItem(cacheKey, css)
    } catch {}
  }
}

export function ThemeProvider(props: { children: JSX.Element; defaultTheme?: string }) {
  const [themes, setThemes] = createSignal<Record<string, DesktopTheme>>(DEFAULT_THEMES)
  const [themeId, setThemeIdSignal] = createSignal(props.defaultTheme ?? "oc-1")
  const [colorScheme, setColorSchemeSignal] = createSignal<ColorScheme>("system")
  const [mode, setMode] = createSignal<"light" | "dark">(getSystemMode())
  const [previewThemeId, setPreviewThemeId] = createSignal<string | null>(null)
  const [previewScheme, setPreviewScheme] = createSignal<ColorScheme | null>(null)

  onMount(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      if (colorScheme() === "system") {
        setMode(getSystemMode())
      }
    }
    mediaQuery.addEventListener("change", handler)
    onCleanup(() => mediaQuery.removeEventListener("change", handler))

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
    const currentTheme = themes()[themeId()]
    if (currentTheme) {
      cacheThemeVariants(currentTheme, themeId())
    }
  })

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

  const previewTheme = (id: string) => {
    const theme = themes()[id]
    if (!theme) return
    setPreviewThemeId(id)
    const previewMode = previewScheme() ? (previewScheme() === "system" ? getSystemMode() : previewScheme()!) : mode()
    applyThemeCss(theme, id, previewMode as "light" | "dark")
  }

  const previewColorScheme = (scheme: ColorScheme) => {
    setPreviewScheme(scheme)
    const previewMode = scheme === "system" ? getSystemMode() : scheme
    const id = previewThemeId() ?? themeId()
    const theme = themes()[id]
    if (theme) {
      applyThemeCss(theme, id, previewMode)
    }
  }

  const commitPreview = () => {
    const id = previewThemeId()
    const scheme = previewScheme()
    if (id) {
      setTheme(id)
    }
    if (scheme) {
      setColorSchemePref(scheme)
    }
    setPreviewThemeId(null)
    setPreviewScheme(null)
  }

  const cancelPreview = () => {
    setPreviewThemeId(null)
    setPreviewScheme(null)
    const theme = themes()[themeId()]
    if (theme) {
      applyThemeCss(theme, themeId(), mode())
    }
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
        previewTheme,
        previewColorScheme,
        commitPreview,
        cancelPreview,
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
