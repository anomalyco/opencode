import { CliRenderEvents, SyntaxStyle, type TerminalColors } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { generateSyntax, resolveThemeDocument, themeModes } from "@opencode-ai/theme/tui"
import {
  DEFAULT_THEMES,
  addTheme,
  allThemes,
  hasTheme,
  parseTheme,
  selectedForeground,
  setCustomThemes,
  setSystemTheme,
  subscribeThemes,
  upsertTheme,
  type Theme,
  type ThemeDocumentSource,
} from "../theme"
import { generateSystem, terminalMode } from "../theme/system"
import { discoverThemes, themeDirectories } from "../theme/discovery"
import { createComponentTheme, type ComponentTheme } from "../theme/component"
import { createEffect, createMemo, onCleanup, onMount, type Accessor, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useConfig } from "../config"
import { Global } from "@opencode-ai/util/global"
import { DevTools } from "../devtools"

const themePerformance = DevTools.register({ id: "theme-performance", title: "Theme performance" })
export type ThemeError = { name: string; error: Error }
type ThemeErrorHandler = (event: ThemeError) => void

function createThemeErrors() {
  let handler: ThemeErrorHandler | undefined
  let pending: ThemeError | undefined

  return {
    emit(name: string, cause: unknown) {
      const event = { name, error: cause instanceof Error ? cause : new Error(String(cause)) }
      if (handler) {
        handler(event)
        return
      }
      pending = event
    },
    onError(next: ThemeErrorHandler) {
      handler = next
      if (pending) {
        next(pending)
        pending = undefined
      }
      return () => {
        if (handler === next) handler = undefined
      }
    },
  }
}

const themeErrors = createThemeErrors()

export type ThemeSource = Readonly<{
  discover(): Promise<Record<string, unknown>>
  subscribeRefresh?(refresh: () => void): () => void
}>

const themeSource: ThemeSource = {
  async discover() {
    return discoverThemes(themeDirectories(Global.Path.config, process.cwd()))
  },
  subscribeRefresh(refresh) {
    process.on("SIGUSR2", refresh)
    return () => process.off("SIGUSR2", refresh)
  },
}

export { discoverThemes } from "../theme/discovery"

export {
  DEFAULT_THEMES,
  addTheme,
  allThemes,
  generateSyntax,
  hasTheme,
  selectedForeground,
  upsertTheme,
  type Theme,
} from "../theme"

const THEME_REFRESH_DELAYS = [250, 1000] as const

type State = {
  themes: Record<string, ThemeDocumentSource>
  mode: "dark" | "light"
  lock: "dark" | "light" | undefined
  active: string
  ready: boolean
}

type ContextName = "elevated" | "overlay"
type ThemeService = {
  themeV2: ComponentTheme
  contextual(context: ContextName): ThemeService
  readonly selected: string
  all: typeof allThemes
  has: typeof hasTheme
  syntax: Accessor<SyntaxStyle>
  mode: Accessor<"dark" | "light">
  modes: Accessor<readonly ("dark" | "light")[]>
  supports(mode: "dark" | "light"): boolean
  locked: Accessor<boolean>
  lock(): void
  unlock(): void
  setMode(mode?: "dark" | "light", persist?: boolean): boolean
  set(theme: string): boolean
  onError(handler: ThemeErrorHandler): () => void
  readonly ready: boolean
}

const [store, setStore] = createStore<State>({
  themes: allThemes(),
  mode: "dark",
  lock: undefined,
  active: "opencode",
  ready: false,
})

subscribeThemes((themes) => setStore("themes", themes))

const themeContext = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light"; source?: ThemeSource }) => {
    const renderer = useRenderer()
    const configState = useConfig()
    const config = configState.data
    const themes = props.source ?? themeSource
    const pick = (value: unknown) => {
      if (value === "dark" || value === "light") return value
      return
    }

    setStore(
      produce((draft) => {
        const lock = pick(config.theme?.mode)
        const mode = lock ?? pick(renderer.themeMode) ?? props.mode
        draft.mode = mode
        draft.lock = lock
        const active = config.theme?.name ?? "opencode"
        draft.active = typeof active === "string" ? active : "opencode"
        draft.ready = false
      }),
    )

    createEffect(() => {
      const theme = config.theme?.name
      if (theme) setStore("active", theme)
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
        .catch(() => setStore("active", "opencode"))
    }

    onMount(() => {
      void Promise.allSettled([resolveSystemTheme(store.mode), syncCustomThemes()]).finally(() => {
        valuesV2()
        setStore("ready", true)
      })
    })

    let systemThemeSignature: string | undefined
    let systemThemeMode: "dark" | "light" | undefined
    let hasResolvedSystemTheme = false
    function resolveSystemTheme(mode: "dark" | "light" = store.mode) {
      return renderer
        .getPalette({ size: 16 })
        .then((colors: TerminalColors) => {
          if (!colors.palette[0]) {
            if (hasResolvedSystemTheme) return
            setSystemTheme(undefined)
            if (store.active === "system") setStore("active", "opencode")
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
          if (store.active === "system") setStore("active", "opencode")
        })
    }

    let systemRefreshRunning = false
    let systemRefreshQueued = false
    let systemRefreshMode = store.mode
    function refreshSystemTheme(mode: "dark" | "light" = store.mode) {
      systemRefreshMode = mode
      if (systemRefreshRunning) {
        systemRefreshQueued = true
        return
      }

      systemRefreshRunning = true
      const retry = renderer.paletteDetectionStatus === "detecting"
      renderer.clearPaletteCache()
      void resolveSystemTheme(mode).finally(() => {
        systemRefreshRunning = false
        if (!retry && !systemRefreshQueued) return
        systemRefreshQueued = false
        refreshSystemTheme(systemRefreshMode)
      })
    }

    function apply(mode: "dark" | "light") {
      if (store.mode === mode) return
      setStore("mode", mode)
      refreshSystemTheme(mode)
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
      refreshSystemTheme(renderer.themeMode ?? store.mode)
      if (!persist) return
      void configState
        .update((draft) => {
          draft.theme = { ...draft.theme, mode: "system" }
        })
        .catch(() => {})
    }

    const handle = (mode: "dark" | "light") => {
      if (store.lock) return
      apply(mode)
    }
    renderer.on(CliRenderEvents.THEME_MODE, handle)

    const handleThemeNotification = (sequence: string) => {
      if (sequence !== "\x1b[?997;1n" && sequence !== "\x1b[?997;2n") return false
      queueMicrotask(() => refreshSystemTheme())
      return false
    }
    renderer.prependInputHandler(handleThemeNotification)

    let themeRefreshTimeouts: ReturnType<typeof setTimeout>[] = []
    const refresh = () => {
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts = THEME_REFRESH_DELAYS.map((delay) =>
        setTimeout(() => {
          refreshSystemTheme()
          if (delay === THEME_REFRESH_DELAYS[THEME_REFRESH_DELAYS.length - 1]) void syncCustomThemes()
        }, delay),
      )
    }
    let unsubscribeRefresh: (() => void) | undefined
    unsubscribeRefresh = themes.subscribeRefresh?.(refresh)

    onCleanup(() => {
      renderer.off(CliRenderEvents.THEME_MODE, handle)
      renderer.removeInputHandler(handleThemeNotification)
      unsubscribeRefresh?.()
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts.length = 0
    })

    const initStarted = performance.now()
    const selected = createMemo(() => {
      const name = store.themes[store.active] ? store.active : "opencode"
      try {
        return loadTheme(store.themes[name], name, store.mode)
      } catch (error) {
        if (name === "opencode") throw error
        themeErrors.emit(name, error)
        setStore("active", "opencode")
        return loadTheme(store.themes.opencode, "opencode", store.mode)
      }
    })
    const modes = () => selected().modes
    const mode = () => selected().mode
    const valuesV2 = () => selected().theme
    valuesV2()
    themePerformance.set("Init", `${(performance.now() - initStarted).toFixed(2)} ms`)
    const themeV2 = createComponentTheme(valuesV2, mode)
    const contextsV2 = {
      elevated: createComponentTheme(() => valuesV2().contexts["@context:elevated"] ?? valuesV2(), mode),
      overlay: createComponentTheme(() => valuesV2().contexts["@context:overlay"] ?? valuesV2(), mode),
    }

    createEffect(() => renderer.setBackgroundColor(valuesV2().background.default))

    const syntax = createSyntaxStyleMemo(() => generateSyntax(valuesV2(), mode()))
    function contextual(context: ContextName) {
      return contextualServices[context]
    }
    const service: ThemeService = {
      themeV2,
      contextual,
      get selected() {
        return store.active
      },
      all: allThemes,
      has: hasTheme,
      syntax,
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
        if (!hasTheme(theme)) return false
        setStore("active", theme)
        void configState
          .update((draft) => {
            draft.theme = { ...draft.theme, name: theme }
          })
          .catch(() => {})
        return true
      },
      onError: themeErrors.onError,
      get ready() {
        return store.ready
      },
    }
    const contextualServices = {
      elevated: Object.assign(Object.create(service) as ThemeService, { themeV2: contextsV2.elevated }),
      overlay: Object.assign(Object.create(service) as ThemeService, { themeV2: contextsV2.overlay }),
    }
    return service
  },
})

export const useTheme = themeContext.use
export const ThemeProvider = themeContext.provider

export function ThemeContextProvider(props: ParentProps<{ context: ContextName }>) {
  const theme = useTheme()
  return (
    <themeContext.context.Provider value={theme.contextual(props.context)}>
      {props.children}
    </themeContext.context.Provider>
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
