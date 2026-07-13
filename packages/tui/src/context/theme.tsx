import { CliRenderEvents, SyntaxStyle, type TerminalColors } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import {
  DEFAULT_THEMES,
  addTheme,
  allThemes,
  generateSyntax,
  hasTheme,
  isTheme,
  resolveTheme,
  selectedForeground,
  setCustomThemes,
  setSystemTheme,
  subscribeThemes,
  upsertTheme,
  type ThemeJson,
} from "../theme"
import { generateSystem, terminalMode } from "../theme/system"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useConfig } from "../config"
import { Global } from "@opencode-ai/core/global"
import { Glob } from "@opencode-ai/core/util/glob"
import { readFile } from "node:fs/promises"
import path from "node:path"

export type ThemeSource = Readonly<{
  discover(): Promise<Record<string, unknown>>
  subscribeRefresh?(refresh: () => void): () => void
}>

const themeSource: ThemeSource = {
  async discover() {
    const directories = [Global.Path.config]
    for (let current = process.cwd(); ; current = path.dirname(current)) {
      directories.push(path.join(current, ".opencode"))
      if (path.dirname(current) === current) break
    }
    return discoverThemes(directories)
  },
  subscribeRefresh(refresh) {
    process.on("SIGUSR2", refresh)
    return () => process.off("SIGUSR2", refresh)
  },
}

export async function discoverThemes(directories: string[]) {
  const result: Record<string, unknown> = {}
  for (const directory of directories) {
    const files = await Glob.scan("themes/*.json", { cwd: directory, absolute: true, dot: true, symlink: true })
    for (const file of files) {
      result[path.basename(file, ".json")] = JSON.parse(await readFile(file, "utf8")) as unknown
    }
  }
  return result
}

export {
  DEFAULT_THEMES,
  addTheme,
  allThemes,
  generateSyntax,
  hasTheme,
  isTheme,
  resolveTheme,
  selectedForeground,
  upsertTheme,
  type Theme,
  type ThemeJson,
} from "../theme"

const THEME_REFRESH_DELAYS = [250, 1000] as const

type State = {
  themes: Record<string, ThemeJson>
  mode: "dark" | "light"
  lock: "dark" | "light" | undefined
  active: string
  ready: boolean
}

const [store, setStore] = createStore<State>({
  themes: allThemes(),
  mode: "dark",
  lock: undefined,
  active: "opencode",
  ready: false,
})

subscribeThemes((themes) => setStore("themes", themes))

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
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
          setCustomThemes(
            Object.entries(themes).reduce<Record<string, ThemeJson>>((result, [name, theme]) => {
              if (isTheme(theme)) result[name] = theme
              return result
            }, {}),
          )
        })
        .catch(() => setStore("active", "opencode"))
    }

    onMount(() => {
      void Promise.allSettled([resolveSystemTheme(store.mode), syncCustomThemes()]).finally(() => {
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

    const values = createMemo(() => {
      const active = store.themes[store.active]
      if (active) return resolveTheme(active, store.mode)
      return resolveTheme(store.themes.opencode, store.mode)
    })

    createEffect(() => renderer.setBackgroundColor(values().background))

    const syntax = createSyntaxStyleMemo(() => generateSyntax(values()))

    return {
      theme: new Proxy(values(), {
        get(_target, prop) {
          // @ts-expect-error Properties are forwarded to the current reactive value.
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all: allThemes,
      has: hasTheme,
      syntax,
      mode: () => store.mode,
      locked: () => store.lock !== undefined,
      lock: () => pin(store.mode),
      unlock: free,
      setMode: pin,
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
      get ready() {
        return store.ready
      },
    }
  },
})

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
