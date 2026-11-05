export type FindRenderer = "highlights" | "overlay"

export type FindBarPosition = {
  readonly top: number
  readonly right: number
}

/** Where a fresh scan puts the current match: the first one, the same index, or one step from it. */
export type FindScanCursor = "reset" | "keep" | { readonly step: 1 | -1 }

export const DEFAULT_FIND_POS: FindBarPosition = Object.freeze({ top: 8, right: 8 })

/**
 * One viewer's find bar. `matches` are the ranges the last scan found; `attempt` grows on every open and close, so a
 * focus frame or scan from an earlier opening cannot touch the current one.
 */
export type FileFindState<M = Range> =
  | { readonly status: "closed"; readonly attempt: number }
  | {
      readonly status: "open"
      readonly attempt: number
      readonly query: string
      readonly matches: readonly M[]
      readonly index: number
      readonly renderer: FindRenderer
      readonly pos: FindBarPosition
    }
  | { readonly status: "disposed" }

export type FileFindEvent<M = Range> =
  | { readonly type: "open.requested"; readonly preferredRenderer: FindRenderer }
  | { readonly type: "focus.frame"; readonly attempt: number }
  | { readonly type: "query.changed"; readonly query: string }
  | { readonly type: "refresh.requested"; readonly reset: boolean; readonly scroll: boolean }
  | {
      readonly type: "matches.measured"
      readonly attempt: number
      readonly matches: readonly M[]
      readonly cursor: FindScanCursor
      readonly scroll: boolean
      readonly preferredRenderer: FindRenderer
    }
  | { readonly type: "highlights.failed"; readonly attempt: number }
  /** `stale` when a held range left the document, as when the virtualizer replaced its rows. */
  | { readonly type: "next.requested"; readonly dir: 1 | -1; readonly stale: boolean }
  | { readonly type: "position.updated"; readonly pos: FindBarPosition }
  | { readonly type: "close.requested" }
  | { readonly type: "disposed" }

export type FileFindEffect<M = Range> =
  | { readonly type: "activate-host" }
  | { readonly type: "deactivate-host" }
  | { readonly type: "unregister-host" }
  | { readonly type: "schedule-focus"; readonly attempt: number }
  | { readonly type: "cancel-focus" }
  | { readonly type: "cancel-frames" }
  | { readonly type: "focus-input" }
  | {
      readonly type: "scan"
      readonly attempt: number
      readonly query: string
      readonly cursor: FindScanCursor
      readonly scroll: boolean
    }
  | {
      readonly type: "render-marks"
      readonly attempt: number
      readonly renderer: FindRenderer
      readonly matches: readonly M[]
      readonly index: number
    }
  | { readonly type: "clear-marks" }
  | { readonly type: "scroll-to-match"; readonly match: M }

export type FileFindTransition<M = Range> = {
  readonly state: FileFindState<M>
  readonly effects: readonly FileFindEffect<M>[]
}

export const INITIAL_FILE_FIND_STATE: FileFindState<never> = Object.freeze({ status: "closed", attempt: 0 })

export const DISPOSED_FILE_FIND_STATE: FileFindState<never> = Object.freeze({ status: "disposed" })

const NO_EFFECTS: readonly never[] = Object.freeze([])

const ACTIVATE_HOST = Object.freeze({ type: "activate-host" as const })

const DEACTIVATE_HOST = Object.freeze({ type: "deactivate-host" as const })

const UNREGISTER_HOST = Object.freeze({ type: "unregister-host" as const })

const CANCEL_FOCUS = Object.freeze({ type: "cancel-focus" as const })

const CANCEL_FRAMES = Object.freeze({ type: "cancel-frames" as const })

const CLEAR_MARKS = Object.freeze({ type: "clear-marks" as const })

const FOCUS_INPUT = Object.freeze({ type: "focus-input" as const })

export function transitionFileFind<M>(state: FileFindState<M>, event: FileFindEvent<M>): FileFindTransition<M> {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return {
      state: DISPOSED_FILE_FIND_STATE,
      effects:
        state.status === "open" ? [CANCEL_FRAMES, CLEAR_MARKS, UNREGISTER_HOST] : [CANCEL_FRAMES, UNREGISTER_HOST],
    }

  if (event.type === "open.requested") {
    const attempt = state.attempt + 1

    // Opening again while open keeps the query and selects it; the cancelled frame of the earlier focus never runs.
    return {
      state:
        state.status === "open"
          ? { ...state, attempt }
          : {
              status: "open",
              attempt,
              query: "",
              matches: [],
              index: 0,
              renderer: event.preferredRenderer,
              pos: DEFAULT_FIND_POS,
            },
      effects:
        state.status === "open"
          ? [ACTIVATE_HOST, CANCEL_FOCUS, { type: "schedule-focus", attempt }]
          : [ACTIVATE_HOST, { type: "schedule-focus", attempt }],
    }
  }

  if (state.status !== "open") return { state, effects: NO_EFFECTS }

  if (event.type === "close.requested")
    return { state: { status: "closed", attempt: state.attempt + 1 }, effects: [CANCEL_FRAMES, CLEAR_MARKS, DEACTIVATE_HOST] }

  const query = state.query.trim()

  if (event.type === "focus.frame") {
    if (event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

    if (!query) return { state, effects: [CLEAR_MARKS, FOCUS_INPUT] }

    return { state, effects: [scan(state.attempt, query, "keep", true), FOCUS_INPUT] }
  }

  if (event.type === "query.changed") {
    const next = event.query.trim()

    if (!next) return { state: { ...state, query: event.query, matches: [], index: 0 }, effects: [CLEAR_MARKS] }

    return { state: { ...state, query: event.query, index: 0 }, effects: [scan(state.attempt, next, "reset", true)] }
  }

  if (event.type === "refresh.requested") {
    if (query) return { state, effects: [scan(state.attempt, query, event.reset ? "reset" : "keep", event.scroll)] }

    if (state.matches.length === 0) return { state, effects: NO_EFFECTS }

    return { state: { ...state, matches: [], index: 0 }, effects: [CLEAR_MARKS] }
  }

  if (event.type === "matches.measured") {
    if (event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }
    const index = cursorIndex(state.index, event.matches.length, event.cursor)
    const match = event.matches[index]
    const next = { ...state, matches: event.matches, index, renderer: event.preferredRenderer }
    const render = marks(next)

    return { state: next, effects: event.scroll && match ? [render, { type: "scroll-to-match", match }] : [render] }
  }

  if (event.type === "highlights.failed") {
    if (event.attempt !== state.attempt || state.renderer !== "highlights") return { state, effects: NO_EFFECTS }
    const next = { ...state, renderer: "overlay" as const }

    // Keep the index: falling back to the overlay is not a new search.
    return { state: next, effects: [marks(next)] }
  }

  if (event.type === "next.requested") {
    if (event.stale && query) return { state, effects: [scan(state.attempt, query, { step: event.dir }, true)] }

    const total = state.matches.length
    const match = total ? state.matches[(state.index + event.dir + total) % total] : undefined

    if (!match) return { state, effects: NO_EFFECTS }
    const next = { ...state, index: (state.index + event.dir + total) % total }

    return { state: next, effects: [marks(next), { type: "scroll-to-match", match }] }
  }

  if (event.type === "position.updated") {
    if (event.pos.top === state.pos.top && event.pos.right === state.pos.right) return { state, effects: NO_EFFECTS }

    return { state: { ...state, pos: event.pos }, effects: NO_EFFECTS }
  }

  return { state, effects: NO_EFFECTS }
}

export function viewFileFind<M>(state: FileFindState<M>) {
  if (state.status !== "open") return { open: false, query: "", count: 0, index: 0, pos: DEFAULT_FIND_POS }

  return { open: true, query: state.query, count: state.matches.length, index: state.index, pos: state.pos }
}

function scan(attempt: number, query: string, cursor: FindScanCursor, scroll: boolean) {
  return { type: "scan" as const, attempt, query, cursor, scroll }
}

function marks<M>(state: Extract<FileFindState<M>, { status: "open" }>): FileFindEffect<M> {
  return {
    type: "render-marks",
    attempt: state.attempt,
    renderer: state.renderer,
    matches: state.matches,
    index: state.index,
  }
}

function cursorIndex(index: number, total: number, cursor: FindScanCursor) {
  if (total === 0 || cursor === "reset") return 0
  const kept = Math.min(index, total - 1)

  if (cursor === "keep") return kept

  return (kept + cursor.step + total) % total
}

/** Every mounted find host, the one whose bar is open, and the one a shortcut opens when focus is in none of them. */
export type FindHostRegistryState<H> = {
  readonly hosts: ReadonlySet<H>
  readonly active: H | undefined
  readonly preferred: H | undefined
}

export type FindHostRegistryEvent<H> =
  | { readonly type: "host.registered"; readonly host: H }
  | { readonly type: "host.unregistered"; readonly host: H }
  | { readonly type: "host.preferred"; readonly host: H }
  | { readonly type: "host.activated"; readonly host: H }
  | { readonly type: "host.deactivated"; readonly host: H }

export type FindHostRegistryEffect<H> =
  | { readonly type: "close-host"; readonly host: H }
  | { readonly type: "clear-shared-highlights" }

export type FindHostRegistryTransition<H> = {
  readonly state: FindHostRegistryState<H>
  readonly effects: readonly FindHostRegistryEffect<H>[]
}

export function createFindHostRegistryState<H>(): FindHostRegistryState<H> {
  return { hosts: new Set(), active: undefined, preferred: undefined }
}

export function transitionFindHostRegistry<H>(
  state: FindHostRegistryState<H>,
  event: FindHostRegistryEvent<H>,
): FindHostRegistryTransition<H> {
  const host = event.host

  if (event.type === "host.registered") {
    if (state.hosts.has(host)) return { state, effects: NO_EFFECTS }

    return { state: { ...state, hosts: new Set(state.hosts).add(host), preferred: state.preferred ?? host }, effects: NO_EFFECTS }
  }

  if (event.type === "host.preferred") {
    if (!state.hosts.has(host) || state.preferred === host) return { state, effects: NO_EFFECTS }

    return { state: { ...state, preferred: host }, effects: NO_EFFECTS }
  }

  // Only one find bar is open at a time: opening one closes the other.
  if (event.type === "host.activated") {
    if (state.active === host && state.preferred === host) return { state, effects: NO_EFFECTS }

    return {
      state: { ...state, active: host, preferred: host },
      effects: state.active && state.active !== host ? [{ type: "close-host", host: state.active }] : NO_EFFECTS,
    }
  }

  if (event.type === "host.deactivated") {
    if (state.active !== host) return { state, effects: NO_EFFECTS }

    return { state: { ...state, active: undefined }, effects: NO_EFFECTS }
  }

  if (!state.hosts.has(host)) return { state, effects: NO_EFFECTS }
  const hosts = new Set(state.hosts)
  hosts.delete(host)

  return {
    state: {
      hosts,
      active: state.active === host ? undefined : state.active,
      preferred: state.preferred === host ? hosts.values().next().value : state.preferred,
    },
    effects: state.active === host ? [{ type: "clear-shared-highlights" }] : NO_EFFECTS,
  }
}

/** `g` only steps an open bar; `f` reopens the open bar, else opens the one focus is in, then the preferred one. */
export function selectShortcutHost<H>(state: FindHostRegistryState<H>, key: "f" | "g", contextHost: () => H | undefined) {
  if (key === "g") return state.active

  return state.active ?? contextHost() ?? state.preferred ?? state.hosts.values().next().value
}
