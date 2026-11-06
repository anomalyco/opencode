// @refresh reload

import { createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createSimpleContext } from "../context/helper"
import oc2ThemeJson from "./themes/oc-2.json"
import { resolveThemeVariant, themeToCss } from "./resolve"
import { resolveThemeVariantV2, themeV2ToCss } from "./v2/resolve"
import type { DesktopTheme } from "./types"
import {
  createThemeState,
  DEFAULT_THEME_ID,
  parseColorScheme,
  selectColorScheme,
  selectMode,
  selectThemeId,
  selectThemesLoading,
  transitionTheme,
  type ColorScheme,
  type ThemeEffect,
  type ThemeEvent,
  type ThemeMachineState,
  type ThemeTransition,
} from "./machine"

export type { ColorScheme } from "./machine"

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
    breeze: "Breeze",
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

function cacheThemeVariants(theme: DesktopTheme) {
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
    /** The window shows the theme: its colors, or until a registered theme arrives, those cached from the last run. */
    onThemeApplied?: (mode: "light" | "dark", scheme: ColorScheme) => void
  }) => {
    // An id no theme has yet stays selected until `settle`: a registered theme can arrive after startup.
    const initial = createThemeState({
      themeId: read(STORAGE_KEYS.THEME_ID) || props.defaultTheme || DEFAULT_THEME_ID,
      scheme: parseColorScheme(read(STORAGE_KEYS.COLOR_SCHEME)),
      systemMode: getSystemMode(),
      defaultTheme: oc2Theme,
      bundled: knownThemes(),
    })

    const [state, setState] = createSignal(initial.state)
    // Import timeouts by attempt.
    const timers = new Map<number, ReturnType<typeof setTimeout>>()
    // `loadThemes` calls waiting for every bundled import to settle.
    const waiters = new Set<() => void>()
    // Transitions an effect or `onThemeApplied` raises wait behind the one running.
    const queue: ((current: ThemeMachineState) => ThemeTransition)[] = []

    const enqueue = (next: (current: ThemeMachineState) => ThemeTransition) => {
      queue.push(next)

      if (queue.length > 1) return

      untrack(() => {
        while (queue[0]) {
          const head = queue[0]
          void Promise.try(() => step(head(state()))).catch((cause: unknown) => console.error(cause))
          queue.shift()
        }
      })
    }

    const dispatch = (event: ThemeEvent) => enqueue((current) => transitionTheme(current, event, knownThemes()))

    // The CSS and storage change before the state, so effects that read computed styles see the new theme.
    const step = (next: ThemeTransition) => {
      next.effects.forEach(
        (effect) => void Promise.try(() => run(effect)).catch((cause: unknown) => console.error(cause)),
      )

      if (next.state !== state()) setState(next.state)

      if (!selectThemesLoading(next.state)) {
        waiters.forEach((resolve) => resolve())
        waiters.clear()
      }

      const shown = next.effects.findLast(
        (effect): effect is Extract<ThemeEffect, { type: "apply-theme" | "notify-applied" }> =>
          effect.type === "apply-theme" || effect.type === "notify-applied",
      )

      if (shown) props.onThemeApplied?.(shown.mode, shown.scheme)
    }

    const run = (effect: ThemeEffect) => {
      if (effect.type === "persist-theme") return write(STORAGE_KEYS.THEME_ID, effect.id)

      if (effect.type === "persist-scheme") return write(STORAGE_KEYS.COLOR_SCHEME, effect.scheme)

      if (effect.type === "cache-theme") return cacheThemeVariants(effect.theme)

      if (effect.type === "clear-cache") return clear()

      if (effect.type === "apply-theme") return applyThemeCss(effect.theme, effect.id, effect.mode)

      if (effect.type === "warn-missing-theme") return console.warn(`Theme "${effect.id}" not found`)

      if (effect.type === "notify-applied") return

      if (effect.type === "cancel-load-timer") {
        clearTimeout(timers.get(effect.attempt))
        timers.delete(effect.attempt)

        return
      }

      if (effect.type === "cancel-all-loads") {
        timers.forEach(clearTimeout)
        timers.clear()

        return
      }

      const file = getFiles()[`./themes/${effect.id}.json`]

      if (!file) return dispatch({ type: "theme.load.failed", id: effect.id, attempt: effect.attempt })

      timers.set(
        effect.attempt,
        setTimeout(() => {
          timers.delete(effect.attempt)
          dispatch({ type: "theme.load.timed-out", id: effect.id, attempt: effect.attempt })
        }, effect.timeoutMs),
      )
      void Promise.try(file).then(
        (mod) => dispatch({ type: "theme.loaded", id: effect.id, attempt: effect.attempt, theme: mod.default }),
        () => dispatch({ type: "theme.load.failed", id: effect.id, attempt: effect.attempt }),
      )
    }

    enqueue(() => initial)

    onMount(() => {
      makeEventListener(window, "storage", (e: StorageEvent) => {
        if (e.key === STORAGE_KEYS.THEME_ID && e.newValue) dispatch({ type: "storage.theme.changed", id: e.newValue })

        if (e.key === STORAGE_KEYS.COLOR_SCHEME && e.newValue)
          dispatch({ type: "storage.scheme.changed", scheme: parseColorScheme(e.newValue) })
      })

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

      makeEventListener(mediaQuery, "change", () =>
        dispatch({ type: "system.mode.changed", mode: mediaQuery.matches ? "dark" : "light" }),
      )
    })

    onCleanup(() => dispatch({ type: "disposed" }))

    const name = (id: string) => state().themes[id]?.name ?? names.get(id) ?? id

    return {
      /** The theme the window shows: a previewed one, the selected one, or the default while that one is not coming. */
      themeId: createMemo(() => selectThemeId(state(), knownThemes())),
      colorScheme: createMemo(() => selectColorScheme(state())),
      /** The mode the window shows, a previewed scheme included. */
      mode: createMemo(() => selectMode(state())),
      // Bundled and registered themes in one list, alphabetical by name.
      ids: () =>
        [...themeIDs(), ...Object.keys(state().themes).filter((id) => !knownThemes().has(id))].toSorted((a, b) =>
          name(a).localeCompare(name(b), undefined, { sensitivity: "base" }),
        ),
      name,
      /** Loads every bundled theme; resolves once each import has loaded, failed or timed out. */
      loadThemes: () => {
        dispatch({ type: "themes.preload" })

        if (!selectThemesLoading(untrack(state))) return Promise.resolve(untrack(state).themes)

        return new Promise<Readonly<Record<string, DesktopTheme>>>((resolve) =>
          waiters.add(() => resolve(untrack(state).themes)),
        )
      },
      themes: () => state().themes,
      setTheme: (id: string) => dispatch({ type: "theme.selected", id }),
      setColorScheme: (scheme: ColorScheme) => dispatch({ type: "scheme.selected", scheme }),
      /** Lists a theme beside the bundled ones until the returned function withdraws it. */
      registerTheme: (theme: DesktopTheme) => {
        dispatch({ type: "theme.registered", theme })

        return () => dispatch({ type: "theme.unregistered", theme })
      },
      /**
       * Every theme source has registered what it will: a selected theme that is still missing is not coming, so the
       * window shows the default theme and keeps the choice for when it returns.
       */
      settle: () => dispatch({ type: "settled" }),
      /** Shows a theme without saving it, until `commitPreview` or `cancelPreview`. */
      previewTheme: (id: string) => dispatch({ type: "preview.theme", id }),
      /** Shows a color scheme without saving it, until `commitPreview` or `cancelPreview`. */
      previewColorScheme: (scheme: ColorScheme) => dispatch({ type: "preview.scheme", scheme }),
      commitPreview: () => dispatch({ type: "preview.committed" }),
      cancelPreview: () => dispatch({ type: "preview.cancelled" }),
    }
  },
})
