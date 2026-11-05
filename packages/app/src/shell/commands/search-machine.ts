import type { SessionInfo } from "@opencode/client/promise"
import type { CommandPaletteEntry } from "./palette"

export const PALETTE_SEARCH_TIMEOUT_MS = 10_000

export const PALETTE_SESSION_DEBOUNCE_MS = 100

/** A source's last answer and the query it answered. */
export type PaletteSearchSettled = {
  readonly query: string
  readonly items: readonly CommandPaletteEntry[]
}

/**
 * One remote source of the palette, such as one server's sessions or the files. Each source settles on its own, so a
 * slow or failing source never holds back or hides another. `seen` keeps every entry the source returned while the
 * palette is open, to match refined queries before the source answers them.
 */
export type PaletteSourceState =
  | {
      readonly status: "loading"
      readonly attempt: number
      readonly settled: PaletteSearchSettled
      readonly seen: readonly CommandPaletteEntry[]
    }
  | {
      readonly status: "ready"
      readonly settled: PaletteSearchSettled
      readonly seen: readonly CommandPaletteEntry[]
    }
  | {
      readonly status: "failed"
      readonly settled: PaletteSearchSettled
      readonly seen: readonly CommandPaletteEntry[]
    }

export type PaletteSearchState =
  | { readonly status: "uninitialized"; readonly count: number }
  | {
      readonly status: "active"
      readonly query: string
      readonly issued: number
      readonly sources: readonly PaletteSourceState[]
    }
  | { readonly status: "disposed" }

export type PaletteSearchEvent =
  | { readonly type: "query.changed"; readonly query: string }
  | {
      readonly type: "source.resolved"
      readonly index: number
      readonly attempt: number
      readonly items: readonly CommandPaletteEntry[]
    }
  | { readonly type: "source.failed"; readonly index: number; readonly attempt: number }
  | { readonly type: "source.timed-out"; readonly index: number; readonly attempt: number }
  | { readonly type: "disposed" }

export type PaletteSearchEffect =
  | {
      readonly type: "source.load"
      readonly index: number
      readonly attempt: number
      readonly query: string
      readonly timeoutMs: number
    }
  | { readonly type: "source.abort"; readonly attempt: number }

export type PaletteSearchTransition = {
  readonly state: PaletteSearchState
  readonly effects: readonly PaletteSearchEffect[]
}

const EMPTY_SETTLED: PaletteSearchSettled = Object.freeze({ query: "", items: Object.freeze([]) })

const DISPOSED_SEARCH: PaletteSearchState = Object.freeze({ status: "disposed" })

export function createPaletteSearchState(count: number): PaletteSearchState {
  return { status: "uninitialized", count }
}

export function transitionPaletteSearch(state: PaletteSearchState, event: PaletteSearchEvent): PaletteSearchTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return { state: DISPOSED_SEARCH, effects: state.status === "active" ? aborts(state.sources) : [] }

  if (event.type === "query.changed") {
    if (state.status === "active" && state.query === event.query) return { state, effects: [] }
    const previous: readonly PaletteSourceState[] =
      state.status === "active"
        ? state.sources
        : Array.from(
            { length: state.count },
            (): PaletteSourceState => ({ status: "ready", settled: EMPTY_SETTLED, seen: [] }),
          )
    const issued = state.status === "active" ? state.issued : 0

    return {
      state: {
        status: "active",
        query: event.query,
        issued: issued + previous.length,
        sources: previous.map(
          (source, index): PaletteSourceState => ({
            status: "loading",
            attempt: issued + index + 1,
            settled: source.settled,
            seen: source.seen,
          }),
        ),
      },
      effects: [
        ...aborts(previous),
        ...previous.map((_, index) => ({
          type: "source.load" as const,
          index,
          attempt: issued + index + 1,
          query: event.query,
          timeoutMs: PALETTE_SEARCH_TIMEOUT_MS,
        })),
      ],
    }
  }

  if (state.status !== "active") return { state, effects: [] }
  const source = state.sources[event.index]

  if (source?.status !== "loading" || source.attempt !== event.attempt) return { state, effects: [] }

  const next: PaletteSourceState =
    event.type === "source.resolved"
      ? {
          status: "ready",
          settled: { query: state.query, items: event.items },
          seen: state.query && event.items.length > 0 ? uniqueByID([...event.items, ...source.seen]) : source.seen,
        }
      : { status: "failed", settled: { query: state.query, items: [] }, seen: source.seen }

  return {
    state: { ...state, sources: state.sources.map((item, index) => (index === event.index ? next : item)) },
    effects: event.type === "source.timed-out" ? [{ type: "source.abort", attempt: event.attempt }] : [],
  }
}

export function selectPaletteSearchLoading(state: PaletteSearchState) {
  return state.status === "active" && state.sources.some((source) => source.status === "loading")
}

/** A source failed the current query; one still answering it is not a failure yet. */
export function selectPaletteSearchFailed(state: PaletteSearchState) {
  return state.status === "active" && state.sources.some((source) => source.status === "failed")
}

export function selectPaletteSearchSources(state: PaletteSearchState): readonly PaletteSourceState[] {
  return state.status === "active" ? state.sources : []
}

function aborts(sources: readonly PaletteSourceState[]): PaletteSearchEffect[] {
  return sources.flatMap((source) =>
    source.status === "loading" ? [{ type: "source.abort" as const, attempt: source.attempt }] : [],
  )
}

function uniqueByID(entries: readonly CommandPaletteEntry[]) {
  const ids = new Set<string>()

  return entries.filter((entry) => !ids.has(entry.id) && !!ids.add(entry.id))
}

/**
 * One server's session search inside the palette or the composer. Typed searches wait for a pause; each new search,
 * or the caller's abort, cancels the one before it. `loaded` keeps the sessions learned while the owner is open.
 */
export type SessionSourceState =
  | { readonly status: "idle"; readonly issued: number; readonly loaded: readonly SessionInfo[] }
  | {
      readonly status: "debouncing"
      readonly issued: number
      readonly attempt: number
      readonly query: string
      readonly loaded: readonly SessionInfo[]
    }
  | {
      readonly status: "loading"
      readonly issued: number
      readonly attempt: number
      readonly query: string
      readonly loaded: readonly SessionInfo[]
    }
  | { readonly status: "disposed"; readonly loaded: readonly SessionInfo[] }

export type SessionSourceEvent =
  | { readonly type: "search.requested"; readonly query: string; readonly delayMs: number }
  | { readonly type: "debounce.fired"; readonly attempt: number }
  /** The caller's signal aborted. */
  | { readonly type: "search.aborted"; readonly attempt: number }
  | { readonly type: "fetch.succeeded"; readonly attempt: number; readonly sessions: readonly SessionInfo[] }
  | { readonly type: "fetch.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "disposed" }

export type SessionSourceEffect =
  | { readonly type: "debounce.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "fetch.start"; readonly attempt: number; readonly query: string }
  /** Stops the attempt's timer and request, and answers its caller with no results. */
  | { readonly type: "attempt.cancel"; readonly attempt: number }
  | {
      readonly type: "attempt.resolve"
      readonly attempt: number
      readonly query: string
      readonly sessions: readonly SessionInfo[]
    }
  | { readonly type: "attempt.reject"; readonly attempt: number; readonly error: unknown }

export type SessionSourceTransition = {
  readonly state: SessionSourceState
  readonly effects: readonly SessionSourceEffect[]
}

export const INITIAL_SESSION_SOURCE_STATE: SessionSourceState = Object.freeze({
  status: "idle",
  issued: 0,
  loaded: Object.freeze([]),
})

export function transitionSessionSource(state: SessionSourceState, event: SessionSourceEvent): SessionSourceTransition {
  if (state.status === "disposed") return { state, effects: [] }
  const cancel: SessionSourceEffect[] =
    state.status === "idle" ? [] : [{ type: "attempt.cancel", attempt: state.attempt }]

  if (event.type === "disposed") return { state: { status: "disposed", loaded: state.loaded }, effects: cancel }

  if (event.type === "search.requested") {
    const attempt = state.issued + 1

    return {
      state: { status: "debouncing", issued: attempt, attempt, query: event.query, loaded: state.loaded },
      effects: [...cancel, { type: "debounce.start", attempt, delayMs: event.delayMs }],
    }
  }

  if (state.status === "idle" || state.attempt !== event.attempt) return { state, effects: [] }
  const idle: SessionSourceState = { status: "idle", issued: state.issued, loaded: state.loaded }

  if (event.type === "search.aborted") return { state: idle, effects: cancel }

  if (event.type === "debounce.fired") {
    if (state.status !== "debouncing") return { state, effects: [] }

    return {
      state: { ...state, status: "loading" },
      effects: [{ type: "fetch.start", attempt: state.attempt, query: state.query }],
    }
  }

  if (state.status !== "loading") return { state, effects: [] }

  if (event.type === "fetch.failed")
    return { state: idle, effects: [{ type: "attempt.reject", attempt: state.attempt, error: event.error }] }

  return {
    state: {
      status: "idle",
      issued: state.issued,
      loaded: [
        ...new Map([...state.loaded, ...event.sessions].map((session) => [session.id, session] as const)).values(),
      ],
    },
    effects: [{ type: "attempt.resolve", attempt: state.attempt, query: state.query, sessions: event.sessions }],
  }
}
