import type { DesktopTheme } from "./types"

export type ColorScheme = "light" | "dark" | "system"

export type ResolvedMode = "light" | "dark"

export const DEFAULT_THEME_ID = "oc-2"

/** A bundled theme import that has not settled by then shows the default theme until it arrives. */
export const THEME_LOAD_TIMEOUT_MS = 5_000

export type ThemeSelection = { readonly themeId: string; readonly scheme: ColorScheme }

/** Overrides one or both axes of the committed selection; a preview with neither is `committed`. */
export type ThemePreview = { readonly themeId?: string; readonly scheme?: ColorScheme }

/** What the window shows. `preload` is a registered theme that may still arrive: the cached colors stay on screen. */
export type AppliedTheme =
  | {
      readonly kind: "theme"
      readonly id: string
      readonly theme: DesktopTheme
      readonly mode: ResolvedMode
      readonly scheme: ColorScheme
    }
  | { readonly kind: "preload"; readonly id: string; readonly mode: ResolvedMode; readonly scheme: ColorScheme }

/** The colors in localStorage that the next start paints before the app loads. `unknown` keeps the last run's. */
export type CachedTheme =
  | { readonly status: "unknown" }
  | { readonly status: "cleared" }
  | { readonly status: "cached"; readonly id: string; readonly theme: DesktopTheme }

type ThemeData = {
  readonly committed: ThemeSelection
  readonly systemMode: ResolvedMode
  /** `settled` once every theme source has registered what it will: a missing registered theme is not coming. */
  readonly registration: "pending" | "settled"
  /** Loaded bundled themes and registered themes, by id. */
  readonly themes: Readonly<Record<string, DesktopTheme>>
  /** The attempt of each bundled theme import in flight, including one that timed out and may still arrive. */
  readonly loads: Readonly<Record<string, number>>
  /**
   * Bundled themes the window shows the default theme for: the import failed, or timed out and may still arrive.
   * Selecting, previewing or preloading one tries again.
   */
  readonly failed: Readonly<Record<string, true>>
  readonly issued: number
  readonly applied: AppliedTheme | undefined
  readonly cached: CachedTheme
}

export type ThemeMachineState =
  | ({ readonly status: "committed" } & ThemeData)
  | ({ readonly status: "previewing"; readonly preview: ThemePreview } & ThemeData)
  | ({ readonly status: "disposed" } & ThemeData)

type ActiveState = Exclude<ThemeMachineState, { status: "disposed" }>

export type ThemeEvent =
  | { readonly type: "theme.selected"; readonly id: string }
  | { readonly type: "scheme.selected"; readonly scheme: ColorScheme }
  | { readonly type: "preview.theme"; readonly id: string }
  | { readonly type: "preview.scheme"; readonly scheme: ColorScheme }
  | { readonly type: "preview.committed" }
  | { readonly type: "preview.cancelled" }
  | { readonly type: "theme.registered"; readonly theme: DesktopTheme }
  | { readonly type: "theme.unregistered"; readonly theme: DesktopTheme }
  | { readonly type: "settled" }
  | { readonly type: "themes.preload" }
  | { readonly type: "theme.loaded"; readonly id: string; readonly attempt: number; readonly theme: DesktopTheme }
  | { readonly type: "theme.load.failed"; readonly id: string; readonly attempt: number }
  | { readonly type: "theme.load.timed-out"; readonly id: string; readonly attempt: number }
  | { readonly type: "system.mode.changed"; readonly mode: ResolvedMode }
  | { readonly type: "storage.theme.changed"; readonly id: string }
  | { readonly type: "storage.scheme.changed"; readonly scheme: ColorScheme }
  | { readonly type: "disposed" }

export type ThemeEffect =
  | { readonly type: "load-theme"; readonly id: string; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "cancel-load-timer"; readonly attempt: number }
  | { readonly type: "cancel-all-loads" }
  | { readonly type: "persist-theme"; readonly id: string }
  | { readonly type: "persist-scheme"; readonly scheme: ColorScheme }
  | { readonly type: "cache-theme"; readonly id: string; readonly theme: DesktopTheme }
  | { readonly type: "clear-cache" }
  | {
      readonly type: "apply-theme"
      readonly id: string
      readonly theme: DesktopTheme
      readonly mode: ResolvedMode
      readonly scheme: ColorScheme
    }
  | { readonly type: "notify-applied"; readonly mode: ResolvedMode; readonly scheme: ColorScheme }
  | { readonly type: "warn-missing-theme"; readonly id: string }

export type ThemeTransition = { readonly state: ThemeMachineState; readonly effects: readonly ThemeEffect[] }

type Step = { readonly state: ActiveState; readonly effects: readonly ThemeEffect[] }

const NO_EFFECTS: readonly ThemeEffect[] = []

export function parseColorScheme(value: string | null | undefined): ColorScheme {
  return value === "light" || value === "dark" ? value : "system"
}

export function createThemeState(input: {
  readonly themeId: string
  readonly scheme: ColorScheme
  readonly systemMode: ResolvedMode
  readonly defaultTheme: DesktopTheme
  readonly bundled: ReadonlySet<string>
}): ThemeTransition {
  return reconcile(
    {
      status: "committed",
      committed: { themeId: input.themeId, scheme: input.scheme },
      systemMode: input.systemMode,
      registration: "pending",
      themes: { [DEFAULT_THEME_ID]: input.defaultTheme },
      loads: {},
      failed: {},
      issued: 0,
      applied: undefined,
      cached: { status: "unknown" },
    },
    input.bundled,
    NO_EFFECTS,
  )
}

export function transitionTheme(
  state: ThemeMachineState,
  event: ThemeEvent,
  bundled: ReadonlySet<string>,
): ThemeTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  switch (event.type) {
    case "theme.selected": {
      if (!known(state, event.id, bundled)) return { state, effects: [{ type: "warn-missing-theme", id: event.id }] }

      if (state.committed.themeId === event.id && !state.failed[event.id] && preview(state).themeId === undefined)
        return { state, effects: NO_EFFECTS }

      return reconcile(
        {
          ...withPreview(state, { ...preview(state), themeId: undefined }),
          ...retry(state, [event.id]),
          committed: { ...state.committed, themeId: event.id },
        },
        bundled,
        [{ type: "persist-theme", id: event.id }],
      )
    }

    case "scheme.selected": {
      if (state.committed.scheme === event.scheme && preview(state).scheme === undefined)
        return { state, effects: NO_EFFECTS }

      return reconcile(
        {
          ...withPreview(state, { ...preview(state), scheme: undefined }),
          committed: { ...state.committed, scheme: event.scheme },
        },
        bundled,
        [{ type: "persist-scheme", scheme: event.scheme }],
      )
    }

    case "preview.theme": {
      if (!event.id || !known(state, event.id, bundled)) return { state, effects: NO_EFFECTS }

      if (preview(state).themeId === event.id && !state.failed[event.id]) return { state, effects: NO_EFFECTS }

      return reconcile(
        { ...withPreview(state, { ...preview(state), themeId: event.id }), ...retry(state, [event.id]) },
        bundled,
        NO_EFFECTS,
      )
    }

    case "preview.scheme": {
      if (preview(state).scheme === event.scheme) return { state, effects: NO_EFFECTS }

      return reconcile(withPreview(state, { ...preview(state), scheme: event.scheme }), bundled, NO_EFFECTS)
    }

    case "preview.committed": {
      if (state.status !== "previewing") return { state, effects: NO_EFFECTS }

      return reconcile(
        {
          ...withPreview(state, {}),
          committed: {
            themeId: state.preview.themeId ?? state.committed.themeId,
            scheme: state.preview.scheme ?? state.committed.scheme,
          },
        },
        bundled,
        [
          ...(state.preview.themeId === undefined
            ? []
            : [{ type: "persist-theme", id: state.preview.themeId } as const]),
          ...(state.preview.scheme === undefined
            ? []
            : [{ type: "persist-scheme", scheme: state.preview.scheme } as const]),
        ],
      )
    }

    case "preview.cancelled": {
      if (state.status !== "previewing") return { state, effects: NO_EFFECTS }

      return reconcile(withPreview(state, {}), bundled, NO_EFFECTS)
    }

    case "theme.registered": {
      if (state.themes[event.theme.id] === event.theme) return { state, effects: NO_EFFECTS }

      return reconcile(
        {
          ...state,
          themes: { ...state.themes, [event.theme.id]: event.theme },
          failed: omit(state.failed, [event.theme.id]),
        },
        bundled,
        NO_EFFECTS,
      )
    }

    case "theme.unregistered": {
      // A theme registered again under the same id replaced this one; leave it.
      if (event.theme.id === DEFAULT_THEME_ID || state.themes[event.theme.id] !== event.theme)
        return { state, effects: NO_EFFECTS }

      return reconcile({ ...state, themes: omit(state.themes, [event.theme.id]) }, bundled, NO_EFFECTS)
    }

    case "settled": {
      if (state.registration === "settled") return { state, effects: NO_EFFECTS }

      return reconcile({ ...state, registration: "settled" }, bundled, NO_EFFECTS)
    }

    case "themes.preload": {
      const queued = [...bundled].filter(
        (id) => id !== DEFAULT_THEME_ID && !state.themes[id] && (state.loads[id] === undefined || state.failed[id]),
      )

      if (queued.length === 0) return { state, effects: NO_EFFECTS }

      const requested = request({ ...state, ...retry(state, queued) }, queued, bundled)

      return reconcile(requested.state, bundled, requested.effects)
    }

    case "theme.loaded": {
      if (state.loads[event.id] !== event.attempt) return { state, effects: NO_EFFECTS }

      return reconcile(
        {
          ...state,
          loads: omit(state.loads, [event.id]),
          failed: omit(state.failed, [event.id]),
          themes: { ...state.themes, [event.id]: event.theme },
        },
        bundled,
        [{ type: "cancel-load-timer", attempt: event.attempt }],
      )
    }

    case "theme.load.failed": {
      if (state.loads[event.id] !== event.attempt) return { state, effects: NO_EFFECTS }

      return reconcile(
        { ...state, loads: omit(state.loads, [event.id]), failed: { ...state.failed, [event.id]: true } },
        bundled,
        [{ type: "cancel-load-timer", attempt: event.attempt }],
      )
    }

    // The window shows the default theme meanwhile, but the attempt stays current: a late import still applies.
    case "theme.load.timed-out": {
      if (state.loads[event.id] !== event.attempt || state.failed[event.id]) return { state, effects: NO_EFFECTS }

      return reconcile({ ...state, failed: { ...state.failed, [event.id]: true } }, bundled, NO_EFFECTS)
    }

    case "system.mode.changed": {
      if (state.systemMode === event.mode) return { state, effects: NO_EFFECTS }

      return reconcile({ ...state, systemMode: event.mode }, bundled, NO_EFFECTS)
    }

    case "storage.theme.changed": {
      if (!event.id || (state.committed.themeId === event.id && !state.failed[event.id]))
        return { state, effects: NO_EFFECTS }

      return reconcile(
        {
          ...state,
          ...retry(state, [event.id]),
          committed: { ...state.committed, themeId: event.id },
        },
        bundled,
        NO_EFFECTS,
      )
    }

    case "storage.scheme.changed": {
      if (state.committed.scheme === event.scheme) return { state, effects: NO_EFFECTS }

      return reconcile({ ...state, committed: { ...state.committed, scheme: event.scheme } }, bundled, NO_EFFECTS)
    }

    case "disposed": {
      const { preview: _, ...data } = { preview: undefined, ...state }

      return {
        state: { ...data, status: "disposed", loads: {} },
        effects: Object.keys(state.loads).length > 0 ? [{ type: "cancel-all-loads" }] : NO_EFFECTS,
      }
    }
  }
}

/** The theme the window should show when nothing is previewed. */
export function selectCommittedThemeId(state: ThemeMachineState, bundled: ReadonlySet<string>) {
  const id = state.committed.themeId

  if (id === DEFAULT_THEME_ID || state.themes[id]) return id

  if (bundled.has(id)) return state.failed[id] ? DEFAULT_THEME_ID : id

  return state.registration === "pending" ? id : DEFAULT_THEME_ID
}

export function selectThemeId(state: ThemeMachineState, bundled: ReadonlySet<string>) {
  return (state.status === "previewing" ? state.preview.themeId : undefined) ?? selectCommittedThemeId(state, bundled)
}

/** The scheme the user chose; a preview does not change it. */
export function selectColorScheme(state: ThemeMachineState) {
  return state.committed.scheme
}

/** The light or dark mode the window shows, preview included. */
export function selectMode(state: ThemeMachineState): ResolvedMode {
  const scheme = previewedScheme(state)

  return scheme === "system" ? state.systemMode : scheme
}

/** An import is still within its timeout. */
export function selectThemesLoading(state: ThemeMachineState) {
  return Object.keys(state.loads).some((id) => !state.failed[id])
}

function reconcile(draft: ActiveState, bundled: ReadonlySet<string>, prefix: readonly ThemeEffect[]): ThemeTransition {
  const valid = validatePreview(draft, bundled)

  const requested = request(
    valid,
    [...new Set([valid.committed.themeId, preview(valid).themeId].filter((id) => id !== undefined))],
    bundled,
  )

  const cached = reconcileCache(requested.state, bundled)
  const applied = reconcileApplied(cached.state, bundled)

  return { state: applied.state, effects: [...prefix, ...requested.effects, ...cached.effects, ...applied.effects] }
}

// A previewed theme that was withdrawn or failed to load leaves the preview; its scheme, if any, stays previewed.
function validatePreview(state: ActiveState, bundled: ReadonlySet<string>): ActiveState {
  const id = preview(state).themeId

  if (id === undefined || id === DEFAULT_THEME_ID || state.themes[id] || (bundled.has(id) && !state.failed[id]))
    return state

  return withPreview(state, { ...preview(state), themeId: undefined })
}

function request(state: ActiveState, ids: readonly string[], bundled: ReadonlySet<string>) {
  return ids.reduce<Step>(
    (result, id) => {
      if (
        id === DEFAULT_THEME_ID ||
        !bundled.has(id) ||
        result.state.themes[id] ||
        result.state.failed[id] ||
        result.state.loads[id] !== undefined
      )
        return result

      const attempt = result.state.issued + 1

      return {
        state: { ...result.state, issued: attempt, loads: { ...result.state.loads, [id]: attempt } },
        effects: [...result.effects, { type: "load-theme", id, attempt, timeoutMs: THEME_LOAD_TIMEOUT_MS }],
      }
    },
    { state, effects: NO_EFFECTS },
  )
}

// The cache follows the committed theme only: a preview never reaches the next start.
function reconcileCache(state: ActiveState, bundled: ReadonlySet<string>): Step {
  const id = state.committed.themeId
  const theme = state.themes[id]

  if (theme && id !== DEFAULT_THEME_ID) {
    if (state.cached.status === "cached" && state.cached.id === id && state.cached.theme === theme)
      return { state, effects: NO_EFFECTS }

    return {
      state: { ...state, cached: { status: "cached", id, theme } },
      effects: [{ type: "cache-theme", id, theme }],
    }
  }

  // A bundled theme that has not loaded (loading, slow or failed) or a registered theme that may still arrive: the last
  // run's colors for it stay, unless they are another theme's.
  const waiting =
    id !== DEFAULT_THEME_ID &&
    (bundled.has(id) || state.registration === "pending") &&
    !(state.cached.status === "cached" && state.cached.id !== id)

  if (waiting || state.cached.status === "cleared") return { state, effects: NO_EFFECTS }

  return {
    state: { ...state, cached: { status: "cleared" } },
    effects: [{ type: "clear-cache" }],
  }
}

function reconcileApplied(state: ActiveState, bundled: ReadonlySet<string>): Step {
  const id = selectThemeId(state, bundled)
  const scheme = previewedScheme(state)
  const mode = selectMode(state)
  const theme = state.themes[id]
  const applied = state.applied

  if (theme) {
    if (
      applied?.kind === "theme" &&
      applied.id === id &&
      applied.theme === theme &&
      applied.mode === mode &&
      applied.scheme === scheme
    )
      return { state, effects: NO_EFFECTS }

    return {
      state: { ...state, applied: { kind: "theme", id, theme, mode, scheme } },
      effects: [{ type: "apply-theme", id, theme, mode, scheme }],
    }
  }

  // A bundled theme is loading: keep what is on screen until it arrives.
  if (bundled.has(id)) return { state, effects: NO_EFFECTS }

  if (applied?.kind === "preload" && applied.id === id && applied.mode === mode && applied.scheme === scheme)
    return { state, effects: NO_EFFECTS }

  return {
    state: { ...state, applied: { kind: "preload", id, mode, scheme } },
    effects: [{ type: "notify-applied", mode, scheme }],
  }
}

function known(state: ThemeMachineState, id: string, bundled: ReadonlySet<string>) {
  return id === DEFAULT_THEME_ID || bundled.has(id) || !!state.themes[id]
}

function preview(state: ThemeMachineState): ThemePreview {
  return state.status === "previewing" ? state.preview : {}
}

function previewedScheme(state: ThemeMachineState) {
  return preview(state).scheme ?? state.committed.scheme
}

function withPreview(state: ActiveState, next: ThemePreview): ActiveState {
  const { preview: _, ...data } = { preview: undefined, ...state }

  if (next.themeId === undefined && next.scheme === undefined) return { ...data, status: "committed" }

  return { ...data, status: "previewing", preview: next }
}

// Clears a failure and drops an import that timed out, so the next request starts a fresh attempt with its own timeout.
function retry(state: ActiveState, ids: readonly string[]) {
  return {
    failed: omit(state.failed, ids),
    loads: omit(
      state.loads,
      ids.filter((id) => state.failed[id]),
    ),
  }
}

function omit<T>(record: Readonly<Record<string, T>>, ids: readonly string[]) {
  if (!ids.some((id) => id in record)) return record

  return Object.fromEntries(Object.entries(record).filter(([id]) => !ids.includes(id)))
}
