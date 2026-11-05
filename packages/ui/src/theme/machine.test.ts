import { expect, test } from "bun:test"
import {
  createThemeState,
  selectColorScheme,
  selectMode,
  selectThemeId,
  selectThemesLoading,
  THEME_LOAD_TIMEOUT_MS,
  transitionTheme,
  type ColorScheme,
  type ResolvedMode,
  type ThemeEffect,
  type ThemeEvent,
  type ThemeMachineState,
} from "./machine"
import type { DesktopTheme } from "./types"

const bundled = new Set(["oc-2", "dracula", "nord", "tokyonight"])

function theme(id: string): DesktopTheme {
  const variant = {
    palette: {
      neutral: "#101418",
      ink: "#e6edf3",
      primary: "#009fff",
      success: "#3fb950",
      warning: "#d29922",
      error: "#f85149",
      info: "#a371f7",
    },
  } as const

  return { name: id, id, light: variant, dark: variant }
}

const oc2 = theme("oc-2")
const dracula = theme("dracula")
const nord = theme("nord")
const tokyonight = theme("tokyonight")
const midnight = theme("acme:midnight")

function start(input: { themeId?: string; scheme?: ColorScheme; systemMode?: ResolvedMode } = {}) {
  return createThemeState({
    themeId: input.themeId ?? "oc-2",
    scheme: input.scheme ?? "dark",
    systemMode: input.systemMode ?? "dark",
    defaultTheme: oc2,
    bundled,
  })
}

function run(state: ThemeMachineState, ...events: ThemeEvent[]) {
  return events.reduce<{ state: ThemeMachineState; effects: ThemeEffect[] }>(
    (result, event) => {
      const next = transitionTheme(result.state, event, bundled)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function applied(effects: readonly ThemeEffect[]) {
  return effects.flatMap((effect) =>
    effect.type === "apply-theme" ? [{ id: effect.id, mode: effect.mode, scheme: effect.scheme }] : [],
  )
}

function storage(effects: readonly ThemeEffect[]) {
  return effects.filter(
    (effect) =>
      effect.type === "persist-theme" ||
      effect.type === "persist-scheme" ||
      effect.type === "cache-theme" ||
      effect.type === "clear-cache",
  )
}

test("a system light/dark flip keeps a previewed scheme until the preview follows the system", () => {
  const previewed = run(start({ scheme: "system", systemMode: "dark" }).state, {
    type: "preview.scheme",
    scheme: "light",
  })

  expect(applied(previewed.effects)).toEqual([{ id: "oc-2", mode: "light", scheme: "light" }])

  const flipped = run(
    previewed.state,
    { type: "system.mode.changed", mode: "light" },
    { type: "system.mode.changed", mode: "dark" },
  )

  expect(flipped.effects).toEqual([])
  expect(selectMode(flipped.state)).toBe("light")
  expect(flipped.state.status).toBe("previewing")

  const system = run(flipped.state, { type: "preview.scheme", scheme: "system" })

  expect(applied(system.effects)).toEqual([{ id: "oc-2", mode: "dark", scheme: "system" }])
  expect(applied(run(system.state, { type: "system.mode.changed", mode: "light" }).effects)).toEqual([
    { id: "oc-2", mode: "light", scheme: "system" },
  ])
})

test("a previewed system scheme follows the system even when the saved scheme is fixed", () => {
  const result = run(
    start({ scheme: "dark", systemMode: "dark" }).state,
    { type: "preview.scheme", scheme: "system" },
    { type: "system.mode.changed", mode: "light" },
  )

  expect(applied(result.effects)).toEqual([
    { id: "oc-2", mode: "dark", scheme: "system" },
    { id: "oc-2", mode: "light", scheme: "system" },
  ])
})

test("registrations, settling and a finished load keep a preview on screen", () => {
  const initial = start({ themeId: "tokyonight" })

  expect(initial.effects).toEqual([
    { type: "load-theme", id: "tokyonight", attempt: 1, timeoutMs: THEME_LOAD_TIMEOUT_MS },
  ])

  const previewed = run(
    initial.state,
    { type: "preview.theme", id: "oc-2" },
    { type: "preview.scheme", scheme: "light" },
  )
  const background = run(
    previewed.state,
    { type: "theme.registered", theme: midnight },
    { type: "settled" },
    { type: "theme.loaded", id: "tokyonight", attempt: 1, theme: tokyonight },
  )

  expect(applied(background.effects)).toEqual([])
  expect(storage(background.effects)).toEqual([{ type: "cache-theme", id: "tokyonight", theme: tokyonight }])

  const cancelled = run(background.state, { type: "preview.cancelled" })

  expect(applied(cancelled.effects)).toEqual([{ id: "tokyonight", mode: "dark", scheme: "dark" }])
})

test("another tab's theme choice becomes the saved theme behind a preview", () => {
  const previewed = run(
    start().state,
    { type: "preview.theme", id: "dracula" },
    { type: "theme.loaded", id: "dracula", attempt: 1, theme: dracula },
  )
  const changed = run(
    previewed.state,
    { type: "storage.theme.changed", id: "nord" },
    { type: "theme.loaded", id: "nord", attempt: 2, theme: nord },
  )

  expect(applied(changed.effects)).toEqual([])
  expect(selectThemeId(changed.state, bundled)).toBe("dracula")
  expect(applied(run(changed.state, { type: "preview.cancelled" }).effects)).toEqual([
    { id: "nord", mode: "dark", scheme: "dark" },
  ])
})

test("a saved theme that finishes loading after cancel and a new preview stays behind the new preview", () => {
  const result = run(
    start({ themeId: "nord" }).state,
    { type: "preview.theme", id: "oc-2" },
    { type: "preview.cancelled" },
    { type: "preview.theme", id: "oc-2" },
  )
  const loaded = run(result.state, { type: "theme.loaded", id: "nord", attempt: 1, theme: nord })

  expect(applied(result.effects)).toEqual([{ id: "oc-2", mode: "dark", scheme: "dark" }])
  expect(applied(loaded.effects)).toEqual([])
  expect(selectThemeId(loaded.state, bundled)).toBe("oc-2")
})

test("selecting a theme ends its preview, and the previewed theme's late load does not paint", () => {
  const selected = run(
    start({ themeId: "nord" }).state,
    { type: "theme.loaded", id: "nord", attempt: 1, theme: nord },
    { type: "preview.theme", id: "dracula" },
    { type: "theme.selected", id: "oc-2" },
  )

  expect(selected.state.status).toBe("committed")
  expect(applied(selected.effects).at(-1)).toEqual({ id: "oc-2", mode: "dark", scheme: "dark" })

  const late = run(selected.state, { type: "theme.loaded", id: "dracula", attempt: 2, theme: dracula })

  expect(late.effects).toEqual([{ type: "cancel-load-timer", attempt: 2 }])
  expect(run(late.state, { type: "preview.committed" }).effects).toEqual([])
})

test("selecting a theme keeps a previewed scheme", () => {
  const result = run(
    start().state,
    { type: "preview.theme", id: "dracula" },
    { type: "preview.scheme", scheme: "light" },
    { type: "theme.selected", id: "oc-2" },
  )

  expect(result.state.status === "previewing" && result.state.preview).toEqual({ scheme: "light" })
  expect(applied(result.effects)).toEqual([{ id: "oc-2", mode: "light", scheme: "light" }])
})

test("previews never touch storage; committing saves both axes without painting again", () => {
  const previewed = run(
    start({ themeId: "nord" }).state,
    { type: "theme.loaded", id: "nord", attempt: 1, theme: nord },
    { type: "preview.theme", id: "dracula" },
    { type: "theme.loaded", id: "dracula", attempt: 2, theme: dracula },
    { type: "preview.scheme", scheme: "light" },
  )
  const cancelled = run(previewed.state, { type: "preview.cancelled" })

  expect(storage(previewed.effects)).toEqual([{ type: "cache-theme", id: "nord", theme: nord }])
  expect(storage(cancelled.effects)).toEqual([])

  const committed = run(previewed.state, { type: "preview.committed" })

  expect(storage(committed.effects)).toEqual([
    { type: "persist-theme", id: "dracula" },
    { type: "persist-scheme", scheme: "light" },
    { type: "cache-theme", id: "dracula", theme: dracula },
  ])
  expect(applied(committed.effects)).toEqual([])
})

test("a plugin theme withdrawn and registered again caches both variants again", () => {
  const selected = run(
    start().state,
    { type: "theme.registered", theme: midnight },
    { type: "settled" },
    { type: "theme.selected", id: "acme:midnight" },
  )
  const withdrawn = run(selected.state, { type: "theme.unregistered", theme: midnight })

  expect(withdrawn.effects).toEqual([{ type: "clear-cache" }, expect.objectContaining({ type: "apply-theme", id: "oc-2" })])

  const restored = run(withdrawn.state, { type: "theme.registered", theme: midnight })

  expect(restored.effects).toEqual([
    { type: "cache-theme", id: "acme:midnight", theme: midnight },
    expect.objectContaining({ type: "apply-theme", id: "acme:midnight" }),
  ])
})

test("mode and theme id follow a preview and return on cancel; the saved scheme does not", () => {
  const state = start({ themeId: "oc-2", scheme: "dark" }).state
  const previewed = run(state, { type: "preview.scheme", scheme: "light" }, { type: "preview.theme", id: "dracula" })

  expect([selectMode(previewed.state), selectThemeId(previewed.state, bundled), selectColorScheme(previewed.state)]).toEqual(
    ["light", "dracula", "dark"],
  )

  const cancelled = run(previewed.state, { type: "preview.cancelled" }).state

  expect([selectMode(cancelled), selectThemeId(cancelled, bundled), selectColorScheme(cancelled)]).toEqual([
    "dark",
    "oc-2",
    "dark",
  ])

  const committed = run(previewed.state, { type: "preview.committed" }).state

  expect([selectMode(committed), selectThemeId(committed, bundled), selectColorScheme(committed)]).toEqual([
    "light",
    "dracula",
    "light",
  ])
})

test.each([
  { name: "failed", event: { type: "theme.load.failed", id: "tokyonight", attempt: 1 } as const },
  { name: "timed out", event: { type: "theme.load.timed-out", id: "tokyonight", attempt: 1 } as const },
])("a bundled theme whose import $name falls back to the default theme and loads again when selected", (input) => {
  const fallback = run(start({ themeId: "tokyonight" }).state, input.event)

  expect(selectThemeId(fallback.state, bundled)).toBe("oc-2")
  expect(fallback.effects).toEqual([
    ...(input.event.type === "theme.load.failed" ? [{ type: "cancel-load-timer", attempt: 1 }] : []),
    { type: "clear-cache" },
    expect.objectContaining({ type: "apply-theme", id: "oc-2" }),
  ])
  expect(selectThemesLoading(fallback.state)).toBe(false)

  const late = run(fallback.state, { type: "theme.loaded", id: "tokyonight", attempt: 1, theme: tokyonight })

  expect(late.state).toBe(fallback.state)
  expect(late.effects).toEqual([])

  const retried = run(fallback.state, { type: "theme.selected", id: "tokyonight" })

  expect(retried.effects).toEqual([
    { type: "persist-theme", id: "tokyonight" },
    { type: "load-theme", id: "tokyonight", attempt: 2, timeoutMs: THEME_LOAD_TIMEOUT_MS },
  ])

  const loaded = run(retried.state, { type: "theme.loaded", id: "tokyonight", attempt: 2, theme: tokyonight })

  expect(applied(loaded.effects)).toEqual([{ id: "tokyonight", mode: "dark", scheme: "dark" }])
})

test("withdrawing a previewed plugin theme ends the preview; a replaced theme ignores the old withdrawal", () => {
  const previewed = run(
    start().state,
    { type: "theme.registered", theme: midnight },
    { type: "preview.theme", id: "acme:midnight" },
  )
  const withdrawn = run(previewed.state, { type: "theme.unregistered", theme: midnight })

  expect(withdrawn.state.status).toBe("committed")
  expect(applied(withdrawn.effects)).toEqual([{ id: "oc-2", mode: "dark", scheme: "dark" }])

  const replacement = theme("acme:midnight")
  const replaced = run(previewed.state, { type: "theme.registered", theme: replacement })
  const stale = run(replaced.state, { type: "theme.unregistered", theme: midnight })

  expect(stale.state).toBe(replaced.state)
  expect(selectThemeId(stale.state, bundled)).toBe("acme:midnight")
})

test("a saved plugin theme keeps the cached colors until plugins settle without it", () => {
  const initial = start({ themeId: "gone:midnight" })

  expect(initial.effects).toEqual([{ type: "notify-applied", mode: "dark", scheme: "dark" }])
  expect(selectThemeId(initial.state, bundled)).toBe("gone:midnight")

  const settled = run(initial.state, { type: "settled" })

  expect(selectThemeId(settled.state, bundled)).toBe("oc-2")
  expect(settled.effects).toEqual([{ type: "clear-cache" }, expect.objectContaining({ type: "apply-theme", id: "oc-2" })])
})

test("preloading skips loaded and loading themes and retries failed ones", () => {
  const failed = run(
    start({ themeId: "nord" }).state,
    { type: "theme.load.failed", id: "nord", attempt: 1 },
    { type: "preview.theme", id: "dracula" },
  )
  const preloaded = run(failed.state, { type: "themes.preload" })

  expect(preloaded.effects).toEqual([
    { type: "load-theme", id: "nord", attempt: 3, timeoutMs: THEME_LOAD_TIMEOUT_MS },
    { type: "load-theme", id: "tokyonight", attempt: 4, timeoutMs: THEME_LOAD_TIMEOUT_MS },
  ])
  expect(selectThemesLoading(preloaded.state)).toBe(true)

  const again = run(preloaded.state, { type: "themes.preload" })

  expect(again.state).toBe(preloaded.state)
  expect(again.effects).toEqual([])
})

test("events that change nothing return the same state", () => {
  const state = run(start().state, { type: "theme.registered", theme: midnight }, { type: "settled" }).state
  const previewing = run(state, { type: "preview.scheme", scheme: "light" }).state
  const unchanged: [ThemeMachineState, ThemeEvent][] = [
    [state, { type: "theme.selected", id: "oc-2" }],
    [state, { type: "scheme.selected", scheme: "dark" }],
    [state, { type: "preview.theme", id: "missing" }],
    [state, { type: "preview.committed" }],
    [state, { type: "preview.cancelled" }],
    [state, { type: "theme.registered", theme: midnight }],
    [state, { type: "theme.unregistered", theme: oc2 }],
    [state, { type: "settled" }],
    [state, { type: "system.mode.changed", mode: "dark" }],
    [state, { type: "storage.theme.changed", id: "oc-2" }],
    [state, { type: "storage.scheme.changed", scheme: "dark" }],
    [state, { type: "theme.loaded", id: "nord", attempt: 9, theme: nord }],
    [state, { type: "theme.load.failed", id: "nord", attempt: 9 }],
    [state, { type: "theme.load.timed-out", id: "nord", attempt: 9 }],
    [previewing, { type: "preview.scheme", scheme: "light" }],
    [previewing, { type: "system.mode.changed", mode: "dark" }],
    [previewing, { type: "preview.theme", id: "missing" }],
  ]

  unchanged.forEach(([current, event]) => {
    const next = transitionTheme(current, event, bundled)

    expect(next.state).toBe(current)
    expect(next.effects).toEqual([])
  })

  expect(run(state, { type: "theme.selected", id: "missing" }).effects).toEqual([
    { type: "warn-missing-theme", id: "missing" },
  ])
})

test("disposal cancels imports and ignores every later event", () => {
  const loading = start({ themeId: "nord" }).state
  const disposed = run(loading, { type: "disposed" })

  expect(disposed.effects).toEqual([{ type: "cancel-all-loads" }])
  expect(selectThemesLoading(disposed.state)).toBe(false)

  const late = run(
    disposed.state,
    { type: "theme.loaded", id: "nord", attempt: 1, theme: nord },
    { type: "theme.selected", id: "dracula" },
  )

  expect(late.state).toBe(disposed.state)
  expect(late.effects).toEqual([])
  expect(run(start().state, { type: "disposed" }).effects).toEqual([])
})
