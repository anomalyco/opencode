// @refresh reload

import { createEffect, onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createSimpleContext } from "../context/helper"
import oc2ThemeJson from "./themes/oc-2.json"
import { resolveThemeVariant, themeToCss } from "./resolve"
import { resolveThemeVariantV2, themeV2ToCss } from "./v2/resolve"
import type { DesktopTheme } from "./types"

export type ColorScheme = "light" | "dark" | "system"

type ThemeState = {
  /** Loaded bundled themes and registered themes, by id. */
  themes: Record<string, DesktopTheme>
  themeId: string
  colorScheme: ColorScheme
  mode: "light" | "dark"
  previewThemeId: string | null
  previewScheme: ColorScheme | null
}

const STORAGE_KEYS = {
  THEME_ID: "opencode-theme-id",
  COLOR_SCHEME: "opencode-color-scheme",
  THEME_CSS_LIGHT: "opencode-theme-css-light",
  THEME_CSS_DARK: "opencode-theme-css-dark",
} as const

const THEME_STYLE_ID = "oc-theme"

let files: Record<string, () => Promise<{ default: DesktopTheme }>> | undefined

let ids: string[] | undefined

let known: Set<string> | undefined

function getFiles() {
  if (files) return files
  files = import.meta.glob<{ default: DesktopTheme }>("./themes/*.json")

  return files
}

function themeIDs() {
  if (ids) return ids
  ids = Object.keys(getFiles())
    .map((path) => path.slice("./themes/".length, -".json".length))
    .sort()

  return ids
}

function knownThemes() {
  if (known) return known
  known = new Set(themeIDs())

  return known
}

const names = new Map(
  Object.entries({
    "oc-2": "OpenCode",
    amoled: "AMOLED",
    aura: "Aura",
    ayu: "Ayu",
    carbonfox: "Carbonfox",
    catppuccin: "Catppuccin",
    "catppuccin-frappe": "Catppuccin Frappe",
    "catppuccin-macchiato": "Catppuccin Macchiato",
    cobalt2: "Cobalt2",
    cursor: "Cursor",
    dracula: "Dracula",
    everforest: "Everforest",
    flexoki: "Flexoki",
    github: "GitHub",
    gruvbox: "Gruvbox",
    kanagawa: "Kanagawa",
    "lucent-orng": "Lucent Orng",
    material: "Material",
    matrix: "Matrix",
    mercury: "Mercury",
    monokai: "Monokai",
    nightowl: "Night Owl",
    nord: "Nord",
    "one-dark": "One Dark",
    onedarkpro: "One Dark Pro",
    orng: "Orng",
    "osaka-jade": "Osaka Jade",
    palenight: "Palenight",
    rosepine: "Rose Pine",
    shadesofpurple: "Shades of Purple",
    solarized: "Solarized",
    synthwave84: "Synthwave '84",
    tokyonight: "Tokyonight",
    vercel: "Vercel",
    vesper: "Vesper",
    zenburn: "Zenburn",
  }),
)

// SAFETY: oc-2.json follows desktop-theme.schema.json; JSON modules only widen its colors to `string`, and
// v2/resolve.test.ts resolves the same file as a DesktopTheme.
const oc2Theme = oc2ThemeJson as DesktopTheme

// Storage access throws where localStorage is missing or blocked; every caller treats that as no stored value.
function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

function drop(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {}
}

function readScheme(): ColorScheme {
  const value = read(STORAGE_KEYS.COLOR_SCHEME)

  return value === "light" || value === "dark" ? value : "system"
}

function clear() {
  drop(STORAGE_KEYS.THEME_CSS_LIGHT)
  drop(STORAGE_KEYS.THEME_CSS_DARK)
}

function ensureThemeStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ID)

  if (existing instanceof HTMLStyleElement) return existing
  const element = document.createElement("style")
  element.id = THEME_STYLE_ID
  document.head.appendChild(element)

  return element
}

function getSystemMode(): "light" | "dark" {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyThemeCss(theme: DesktopTheme, themeId: string, mode: "light" | "dark") {
  const isDark = mode === "dark"
  const variant = isDark ? theme.dark : theme.light
  const tokens = resolveThemeVariant(variant, isDark)
  const css = themeToCss(tokens)
  const v2 = themeV2ToCss(resolveThemeVariantV2(variant, isDark))

  if (themeId !== "oc-2") {
    write(isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, `${css}\n  ${v2}`)
  }

  const fullCss = `:root {
  color-scheme: ${mode};
  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
  ${css}
  ${v2}
}`

  document.getElementById("oc-theme-preload")?.remove()
  ensureThemeStyleElement().textContent = fullCss
  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  // Update theme-color meta tag to match light/dark mode
  const meta = document.querySelector('meta[name="theme-color"]')

  if (meta) meta.setAttribute("content", isDark ? "#080808" : "#fafafa")
}

function cacheThemeVariants(theme: DesktopTheme, themeId: string) {
  if (themeId === "oc-2") return

  for (const mode of ["light", "dark"] as const) {
    const isDark = mode === "dark"
    const variant = isDark ? theme.dark : theme.light
    const tokens = resolveThemeVariant(variant, isDark)
    const css = themeToCss(tokens)
    const v2 = themeV2ToCss(resolveThemeVariantV2(variant, isDark))
    write(isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, `${css}\n  ${v2}`)
  }
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: {
    defaultTheme?: string
    onThemeApplied?: (theme: DesktopTheme, mode: "light" | "dark", scheme: ColorScheme) => void
  }) => {
    // An id no theme has yet stays selected: a registered theme can arrive after startup.
    const themeId = read(STORAGE_KEYS.THEME_ID) || props.defaultTheme || "oc-2"
    const colorScheme = readScheme()
    const mode = colorScheme === "system" ? getSystemMode() : colorScheme

    const [store, setStore] = createStore<ThemeState>({
      themes: {
        "oc-2": oc2Theme,
      },
      themeId,
      colorScheme,
      mode,
      previewThemeId: null,
      previewScheme: null,
    })

    const loads = new Map<string, Promise<DesktopTheme | undefined>>()

    const load = (id: string) => {
      const next = id

      if (!next) return Promise.resolve(undefined)
      const hit = store.themes[next]

      if (hit) return Promise.resolve(hit)
      const pending = loads.get(next)

      if (pending) return pending
      const file = getFiles()[`./themes/${next}.json`]

      if (!file) return Promise.resolve(undefined)

      const task = file()
        .then((mod) => {
          const theme = mod.default
          setStore("themes", next, theme)

          return theme
        })
        .finally(() => {
          loads.delete(next)
        })

      loads.set(next, task)

      return task
    }

    const applyTheme = (theme: DesktopTheme, themeId: string, mode: "light" | "dark", scheme: ColorScheme) => {
      applyThemeCss(theme, themeId, mode)
      props.onThemeApplied?.(theme, mode, scheme)
    }

    const ids = () => {
      const extra = Object.keys(store.themes)
        .filter((id) => !knownThemes().has(id))
        .sort()

      const all = themeIDs()

      if (extra.length === 0) return all

      return [...all, ...extra]
    }

    const loadThemes = () => Promise.all(themeIDs().map(load)).then(() => store.themes)

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.THEME_ID && e.newValue) {
        const next = e.newValue
        setStore("themeId", next)

        if (next === "oc-2") {
          clear()

          return
        }

        void load(next).then((theme) => {
          if (!theme || store.themeId !== next) return
          cacheThemeVariants(theme, next)
        })
      }

      if (e.key === STORAGE_KEYS.COLOR_SCHEME && e.newValue) {
        const scheme = readScheme()
        setStore("colorScheme", scheme)
        setStore("mode", scheme === "system" ? getSystemMode() : scheme)
      }
    }

    onMount(() => {
      makeEventListener(window, "storage", onStorage)

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

      const onMedia = () => {
        if (store.colorScheme !== "system") return
        setStore("mode", getSystemMode())
      }

      makeEventListener(mediaQuery, "change", onMedia)

      const savedTheme = read(STORAGE_KEYS.THEME_ID) || props.defaultTheme || "oc-2"
      const savedScheme = readScheme()

      if (savedTheme !== store.themeId) setStore("themeId", savedTheme)

      if (savedScheme !== store.colorScheme) setStore("colorScheme", savedScheme)
      setStore("mode", savedScheme === "system" ? getSystemMode() : savedScheme)
      void load(savedTheme).then((theme) => {
        if (!theme || store.themeId !== savedTheme) return
        cacheThemeVariants(theme, savedTheme)
      })
    })

    createEffect(() => {
      const theme = store.themes[store.themeId]

      if (theme) {
        applyTheme(theme, store.themeId, store.mode, store.colorScheme)

        return
      }

      // Keep what is on screen while a bundled theme loads, and at startup, the CSS cached from the last run until a
      // registered theme arrives. A registered theme missing later was withdrawn: show the default theme until it
      // returns.
      if (knownThemes().has(store.themeId) || !document.getElementById(THEME_STYLE_ID)) return
      applyTheme(oc2Theme, "oc-2", store.mode, store.colorScheme)
    })

    const setTheme = (id: string) => {
      const next = id

      if (!next) {
        console.warn(`Theme "${id}" not found`)

        return
      }

      if (next !== "oc-2" && !knownThemes().has(next) && !store.themes[next]) {
        console.warn(`Theme "${id}" not found`)

        return
      }

      setStore("themeId", next)

      if (next === "oc-2") {
        write(STORAGE_KEYS.THEME_ID, next)
        clear()

        return
      }

      void load(next).then((theme) => {
        if (!theme || store.themeId !== next) return
        cacheThemeVariants(theme, next)
        write(STORAGE_KEYS.THEME_ID, next)
      })
    }

    const setColorScheme = (scheme: ColorScheme) => {
      setStore("colorScheme", scheme)
      write(STORAGE_KEYS.COLOR_SCHEME, scheme)
      setStore("mode", scheme === "system" ? getSystemMode() : scheme)
    }

    return {
      themeId: () => store.themeId,
      colorScheme: () => store.colorScheme,
      mode: () => store.mode,
      ids,
      name: (id: string) => store.themes[id]?.name ?? names.get(id) ?? id,
      loadThemes,
      themes: () => store.themes,
      setTheme,
      setColorScheme,
      /** Lists a theme after the bundled ones until the returned function withdraws it. */
      registerTheme: (theme: DesktopTheme) => {
        setStore("themes", theme.id, theme)

        return () => {
          // A theme registered again under the same id replaces this one; leave it.
          if (unwrap(store.themes)[theme.id] !== theme) return
          setStore(
            "themes",
            produce((themes) => {
              delete themes[theme.id]
            }),
          )
        }
      },
      previewTheme: (id: string) => {
        const next = id

        if (!next) return

        if (next !== "oc-2" && !knownThemes().has(next) && !store.themes[next]) return
        setStore("previewThemeId", next)
        void load(next).then((theme) => {
          if (!theme || store.previewThemeId !== next) return

          const mode = store.previewScheme
            ? store.previewScheme === "system"
              ? getSystemMode()
              : store.previewScheme
            : store.mode

          applyTheme(theme, next, mode, store.previewScheme ?? store.colorScheme)
        })
      },
      previewColorScheme: (scheme: ColorScheme) => {
        setStore("previewScheme", scheme)
        const mode = scheme === "system" ? getSystemMode() : scheme
        const id = store.previewThemeId ?? store.themeId
        void load(id).then((theme) => {
          if (!theme) return

          if ((store.previewThemeId ?? store.themeId) !== id) return

          if (store.previewScheme !== scheme) return
          applyTheme(theme, id, mode, scheme)
        })
      },
      commitPreview: () => {
        if (store.previewThemeId) {
          setTheme(store.previewThemeId)
        }

        if (store.previewScheme) {
          setColorScheme(store.previewScheme)
        }

        setStore("previewThemeId", null)
        setStore("previewScheme", null)
      },
      cancelPreview: () => {
        setStore("previewThemeId", null)
        setStore("previewScheme", null)
        void load(store.themeId).then((theme) => {
          if (!theme) return
          applyTheme(theme, store.themeId, store.mode, store.colorScheme)
        })
      },
    }
  },
})
