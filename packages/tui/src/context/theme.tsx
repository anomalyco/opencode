import { CliRenderEvents, SyntaxStyle, type TerminalColors } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  DEFAULT_THEMES,
  type Theme,
  addTheme,
  allThemes,
  generateSubtleSyntax,
  generateSyntax,
  resolveThemeDocument,
  themeModes,
  type ResolvedTheme,
  type SurfaceName,
} from "@opencode/theme/tui"
import {
  allThemes,
  getOpenCode2Theme,
  hasTheme,
  parseTheme,
  setCustomThemes,
  setSystemTheme,
  subscribeThemes,
  type ThemeDocumentSource,
} from "../theme"
import { generateSystem, terminalMode } from "../theme/system"
import { discoverThemes } from "../theme/discovery"
import { createComponentTheme, type ComponentTheme } from "../theme/component"
import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useKV } from "./kv"
import { useTuiConfig } from "../config"
import { Global } from "@bolt-ai/core/global"
import { Glob } from "@bolt-ai/core/util/glob"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type ThemeSource = Readonly<{
  discover(): Promise<Record<string, unknown>>
  subscribeRefresh?(refresh: () => void): () => void
}>

export const createThemeSource = (config: string): ThemeSource => ({
  async discover() {
    const directories = [Global.Path.config]
    for (let current = process.cwd(); ; current = path.dirname(current)) {
      directories.push(path.join(current, ".bolt"))
      if (path.dirname(current) === current) break
    }
    return discoverThemes(directories)
  },
  subscribeRefresh(refresh) {
    process.on("SIGUSR2", refresh)
    return () => process.off("SIGUSR2", refresh)
  },
})

const THEME_REFRESH_DELAYS = [250, 1000] as const

type State = {
  mode: "dark" | "light"
  lock: "dark" | "light" | undefined
  active: string
  ready: boolean
}

type Themes = {
  current: ComponentTheme
  currentTokens: Accessor<ResolvedTheme>
  readonly selected: string
  all: typeof allThemes
  has: typeof hasTheme
  currentSyntax: Accessor<SyntaxStyle>
  mode: Accessor<"dark" | "light">
  modes: Accessor<readonly ("dark" | "light")[]>
  supports(mode: "dark" | "light"): boolean
  locked: Accessor<boolean>
  lock(): void
  unlock(): void
  setMode(mode?: "dark" | "light", persist?: boolean): boolean
  set(theme: string): boolean
  afterPaint(): void
  onError(handler: ThemeErrorHandler): () => void
  readonly ready: boolean
}

type ThemeContextValue = {
  current: ComponentTheme
  themes: Themes
  readonly ready: boolean
}

const [store, setStore] = createStore<State>({
  mode: "dark",
  lock: undefined,
  active: "bolt",
  ready: false,
})
const [themeSources, setThemeSources] = createSignal(allThemes())

subscribeThemes(setThemeSources)

const themeContext = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light"; source: ThemeSource }): ThemeContextValue => {
    const renderer = useRenderer()
    const configState = useConfig()
    const newDesigns = useNewDesigns()
    const config = configState.data
    const themes = props.source
    const cache = useStorageOptional()?.store<{ colors?: TerminalColors }>("system-theme", { initial: {} })

    setStore(
      produce((draft) => {
        const lock = config.theme?.mode === "dark" || config.theme?.mode === "light" ? config.theme.mode : undefined
        const mode = lock ?? renderer.themeMode ?? props.mode
        draft.mode = mode
        draft.lock = lock
        const active = config.theme ?? kv.get("theme", "bolt")
        draft.active = typeof active === "string" ? active : "bolt"
        draft.ready = false
      }),
    )

    createEffect(() => {
      const theme = config.theme?.name
      if (!theme) return
      setStore("active", theme)
      if (theme === "system") refreshPalette()
    })

    createEffect(() => {
      const mode = config.theme?.mode
      if (mode === "dark" || mode === "light") {
        pin(mode, false)
        return
      }
      if (mode === "system" && store.lock !== undefined) free(false)
    })

    function syncCustomThemes() {
      return themes
        .discover()
        .then((themes) => {
          setCustomThemes(themes)
        })
        .catch(() => setStore("active", "bolt"))
    }

    onMount(() => {
      // Terminal palette queries serialize with frame output. First paint uses the cached palette or built-in fallback.
      void syncCustomThemes().finally(() => {
        tokens()
        setStore("ready", true)
      })
    })

    const cachedPalette = cache?.[0].colors
    let palette = usablePalette(cachedPalette) ? cachedPalette : undefined
    const applyPalette = () => {
      if (palette) setSystemTheme(generateSystem(palette, store.mode))
    }
    if (palette) {
      const mode = store.lock ?? terminalMode(palette) ?? store.mode
      if (store.mode !== mode) setStore("mode", mode)
      applyPalette()
    } else setSystemTheme(undefined)

    let canProbe = false
    let probing = false
    let queued = false
    let disposed = false
    function refreshPalette() {
      if (store.active !== "system") return
      queued = true
      if (!canProbe || probing || disposed) return

      queued = false
      probing = true
      // Clearing does not cancel a query already owned by the renderer. Share it, then run one fresh query.
      const retry = renderer.paletteDetectionStatus === "detecting"
      renderer.clearPaletteCache()
      void renderer
        .getPalette({ size: 16 })
        .then((colors: TerminalColors) => {
          if (!colors.palette[0]) {
            if (hasResolvedSystemTheme) return
            setSystemTheme(undefined)
            if (store.active === "system") setStore("active", "bolt")
            return
          }
          const next = store.lock ?? terminalMode(colors) ?? mode
          if (store.mode !== next) setStore("mode", next)
          const signature = JSON.stringify(colors)
          hasResolvedSystemTheme = true
          if (store.themes.system && systemThemeSignature === signature && systemThemeMode === next) return
          systemThemeSignature = signature
          systemThemeMode = next
          setSystemTheme(generateSystem(colors, next))
        })
        .catch(() => {
          if (hasResolvedSystemTheme) return
          setSystemTheme(undefined)
          if (store.active === "system") setStore("active", "bolt")
        })
    }

    function afterPaint() {
      canProbe = true
      refreshPalette()
    }

    function apply(mode: "dark" | "light") {
      if (store.mode !== mode) {
        setStore("mode", mode)
        applyPalette()
      }
      refreshPalette()
    }

    function pin(mode: "dark" | "light" = store.mode, persist = true) {
      setStore("lock", mode)
      apply(mode)
      if (!persist) return
      void configState
        .update((draft) => {
          draft.theme = { ...draft.theme, mode }
        })
        .catch(() => {})
    }

    function free(persist = true) {
      setStore("lock", undefined)
      apply(renderer.themeMode ?? store.mode)
      if (!persist) return
      void configState
        .update((draft) => {
          draft.theme = { ...draft.theme, mode: "system" }
        })
        .catch(() => {})
    }

    const handleMode = (mode: "dark" | "light") => {
      if (store.lock) return
      apply(mode)
    }
    renderer.on(CliRenderEvents.THEME_MODE, handleMode)

    const handleThemeNotification = (sequence: string) => {
      if (sequence !== "\x1b[?997;1n" && sequence !== "\x1b[?997;2n") return false
      queueMicrotask(refreshPalette)
      return false
    }
    renderer.prependInputHandler(handleThemeNotification)

    let themeRefreshTimeouts: ReturnType<typeof setTimeout>[] = []
    const refreshThemes = () => {
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts = THEME_REFRESH_DELAYS.map((delay) =>
        setTimeout(() => {
          refreshPalette()
          if (delay === THEME_REFRESH_DELAYS[THEME_REFRESH_DELAYS.length - 1]) void syncCustomThemes()
        }, delay),
      )
    }
    const unsubscribeRefresh = themes.subscribeRefresh?.(refreshThemes)

    onCleanup(() => {
      disposed = true
      renderer.off(CliRenderEvents.THEME_MODE, handleMode)
      renderer.removeInputHandler(handleThemeNotification)
      unsubscribeRefresh?.()
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts.length = 0
    })

    const available = createMemo(
      (): Record<string, ThemeDocumentSource> =>
        newDesigns() ? { opencode2: getOpenCode2Theme(), ...themeSources() } : themeSources(),
    )
    const has = (name: string) => Boolean(name) && available()[name] !== undefined

    const initStarted = performance.now()
    const selected = createMemo(() => {
      const sources = available()
      const name = sources[store.active] ? store.active : "opencode"
      try {
        return loadTheme(sources[name], name, store.mode)
      } catch (error) {
        if (name === "opencode") throw error
        themeErrors.emit(name, error)
        setStore("active", "opencode")
        return loadTheme(sources.opencode, "opencode", store.mode)
      }

      return (
        resolveTheme(store.themes.bolt, store.mode) || {
          background: { r: 0, g: 0, b: 0, a: 255 },
          text: { r: 255, g: 255, b: 255, a: 255 },
          textMuted: { r: 128, g: 128, b: 128, a: 255 },
        }
      )
    })
    const modes = () => selected().modes
    const mode = () => selected().mode
    const tokens = () => selected().theme
    tokens()
    themePerformance.set("Init", `${(performance.now() - initStarted).toFixed(2)} ms`)
    const current = createComponentTheme(tokens)

    const defaultTheme = () => resolveTheme(store.themes.bolt, store.mode)

    createEffect(() => renderer.setBackgroundColor(values().background))

    const syntax = createSyntaxStyleMemo(() => generateSyntax(values() ?? defaultTheme()))
    const subtleSyntax = createSyntaxStyleMemo(() => generateSubtleSyntax(values() ?? defaultTheme()))

    return {
      theme: new Proxy({} as Theme, {
        get(_target, prop: keyof Theme) {
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all: available,
      has,
      mode,
      modes,
      supports: (requested) => modes().includes(requested),
      locked: () => store.lock !== undefined,
      lock: () => pin(mode()),
      unlock: free,
      setMode(requested = mode(), persist = true) {
        if (!modes().includes(requested)) return false
        pin(requested, persist)
        return true
      },
      set(theme: string) {
        if (!has(theme)) return false
        setStore("active", theme)
        if (theme === "system") refreshPalette()
        void configState
          .update((draft) => {
            draft.theme = { ...draft.theme, name: theme }
          })
          .catch(() => {})
        return true
      },
      afterPaint,
      onError: themeErrors.onError,
      get ready() {
        return store.ready
      },
    }
    return {
      current,
      themes: service,
      get ready() {
        return service.ready
      },
    }
  },
})

export function useThemes() {
  return themeContext.use().themes
}
export function useTheme(): ComponentTheme {
  return themeContext.use().current
}
export const ThemeProvider = themeContext.provider

/** Switches the ambient theme surface without remounting children; undefined inherits the enclosing view. */
export function ThemeContextProvider(props: ParentProps<{ context: SurfaceName | undefined }>) {
  const value = themeContext.use()
  const current = createComponentTheme(() => {
    const name = props.context
    return name ? value.themes.currentTokens().surface(name) : value.current
  })
  return (
    <themeContext.context.Provider value={{ current, themes: value.themes, ready: value.ready }}>
      {props.children}
    </themeContext.context.Provider>
  )
}

function usablePalette(colors: TerminalColors | undefined): colors is TerminalColors {
  return Boolean(
    colors && (colors.defaultBackground ?? colors.palette[0]) && (colors.defaultForeground ?? colors.palette[7]),
  )
}

function loadTheme(source: ThemeDocumentSource, name: string, requested: "dark" | "light") {
  const document = parseTheme(source, name)
  const modes = themeModes(document)
  const mode = modes.includes(requested) ? requested : (modes[0] ?? requested)
  return { modes, mode, theme: resolveThemeDocument(document, mode) }
}

export function createSyntaxStyleMemo(factory: () => SyntaxStyle) {
  const renderer = useRenderer()
  const retained = new Set<SyntaxStyle>()
  let current: SyntaxStyle | undefined

  const release = (style: SyntaxStyle) => {
    retained.add(style)
    void renderer
      .idle()
      .catch(() => {})
      .finally(() => {
        if (!retained.delete(style)) return
        style.destroy()
      })
  }

  onCleanup(() => {
    if (current) release(current)
  })

  return createMemo(() => {
    const previous = current
    current = factory()
    if (previous) release(previous)
    return current
  })
}
