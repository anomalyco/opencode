import { looksLikeSessionID } from "@/session/search"
import type { HomeSessionRecord } from "./records"

export const HOME_SESSION_LOOKUP_TIMEOUT_MS = 10_000

type SearchFields = {
  /** The server and project the results belong to; an exact match from another scope is never shown. */
  readonly scope: string
  readonly connected: boolean
  readonly issued: number
  readonly focused: boolean
  readonly value: string
  readonly highlighted: string
}

/**
 * Home's session search. Typing a session ID looks it up on the focused server; `found` holds that session until the
 * text, server or project changes. The results panel shows while the search has focus and text.
 */
export type HomeSessionSearchState =
  | (SearchFields & { readonly status: "idle" })
  | (SearchFields & { readonly status: "looking-up"; readonly attempt: number; readonly sessionID: string })
  | (SearchFields & { readonly status: "found"; readonly exact: HomeSessionRecord })
  | { readonly status: "disposed" }

export type HomeSessionSearchEvent =
  | { readonly type: "scope.changed"; readonly scope: string; readonly connected: boolean }
  | { readonly type: "focused" }
  /** Focus left the search control, by keyboard or pointer. */
  | { readonly type: "blurred" }
  | { readonly type: "closed" }
  | { readonly type: "input.changed"; readonly value: string }
  | { readonly type: "highlight.changed"; readonly key: string }
  | { readonly type: "lookup.resolved"; readonly attempt: number; readonly record: HomeSessionRecord | undefined }
  | { readonly type: "lookup.failed"; readonly attempt: number }
  | { readonly type: "lookup.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type HomeSessionSearchEffect =
  | { readonly type: "lookup.start"; readonly attempt: number; readonly sessionID: string; readonly timeoutMs: number }
  | { readonly type: "lookup.abort" }

export type HomeSessionSearchTransition = {
  readonly state: HomeSessionSearchState
  readonly effects: readonly HomeSessionSearchEffect[]
}

type LiveState = Exclude<HomeSessionSearchState, { status: "disposed" }>

export const INITIAL_HOME_SESSION_SEARCH_STATE: HomeSessionSearchState = Object.freeze({
  status: "idle",
  scope: "",
  connected: false,
  issued: 0,
  focused: false,
  value: "",
  highlighted: "",
})

const DISPOSED: HomeSessionSearchState = Object.freeze({ status: "disposed" })

const NONE: readonly HomeSessionSearchEffect[] = Object.freeze([])

const ABORT: readonly HomeSessionSearchEffect[] = Object.freeze([{ type: "lookup.abort" }])

export function transitionHomeSessionSearch(
  state: HomeSessionSearchState,
  event: HomeSessionSearchEvent,
): HomeSessionSearchTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED, effects: aborts(state) }

  if (event.type === "focused") return state.focused ? unchanged(state) : changed({ ...state, focused: true })

  if (event.type === "blurred") return state.focused ? changed({ ...state, focused: false }) : unchanged(state)

  if (event.type === "closed") {
    if (state.status === "idle" && !state.focused && !state.value && !state.highlighted) return unchanged(state)

    return settle(state, { ...fields(state), focused: false, value: "", highlighted: "" })
  }

  if (event.type === "input.changed") {
    if (event.value === state.value) return unchanged(state)

    return settle(state, { ...fields(state), value: event.value, highlighted: "" })
  }

  if (event.type === "highlight.changed") {
    return event.key === state.highlighted ? unchanged(state) : changed({ ...state, highlighted: event.key })
  }

  if (event.type === "scope.changed") return rescope(state, event)

  if (state.status !== "looking-up" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "lookup.resolved" && event.record)
    return changed({ ...fields(state), status: "found", exact: event.record })

  return { state: { ...fields(state), status: "idle" }, effects: event.type === "lookup.timed-out" ? ABORT : NONE }
}

export function selectSearchValue(state: HomeSessionSearchState) {
  return state.status === "disposed" ? "" : state.value
}

export function selectSearchQuery(state: HomeSessionSearchState) {
  return selectSearchValue(state).trim()
}

export function selectSearchOpen(state: HomeSessionSearchState) {
  return state.status !== "disposed" && state.focused && selectSearchQuery(state).length > 0
}

export function selectSearchLookingUp(state: HomeSessionSearchState) {
  return state.status === "looking-up"
}

export function selectSearchExact(state: HomeSessionSearchState) {
  return state.status === "found" ? state.exact : undefined
}

export function selectSearchHighlighted(state: HomeSessionSearchState) {
  return state.status === "disposed" ? "" : state.highlighted
}

// Another server or project drops the exact match and looks the ID up again there; a lookup waits for a connection.
function rescope(state: LiveState, event: Extract<HomeSessionSearchEvent, { type: "scope.changed" }>) {
  if (event.scope === state.scope && event.connected === state.connected) return unchanged(state)

  if (event.scope !== state.scope)
    return settle(state, { ...fields(state), scope: event.scope, connected: event.connected, highlighted: "" })

  if (event.connected && state.status === "idle") return settle(state, { ...fields(state), connected: true })

  if (!event.connected && state.status === "looking-up")
    return { state: { ...fields(state), connected: false, status: "idle" as const }, effects: ABORT }

  return changed({ ...state, connected: event.connected })
}

function settle(previous: LiveState, next: SearchFields): HomeSessionSearchTransition {
  const value = next.value.trim()
  const sessionID = looksLikeSessionID(value) ? value : undefined

  if (!sessionID || !next.connected) return { state: { ...next, status: "idle" }, effects: aborts(previous) }

  const attempt = next.issued + 1

  return {
    state: { ...next, status: "looking-up", issued: attempt, attempt, sessionID },
    effects: [
      ...aborts(previous),
      { type: "lookup.start", attempt, sessionID, timeoutMs: HOME_SESSION_LOOKUP_TIMEOUT_MS },
    ],
  }
}

function fields(state: LiveState): SearchFields {
  return {
    scope: state.scope,
    connected: state.connected,
    issued: state.issued,
    focused: state.focused,
    value: state.value,
    highlighted: state.highlighted,
  }
}

function aborts(state: HomeSessionSearchState) {
  return state.status === "looking-up" ? ABORT : NONE
}

function changed(state: HomeSessionSearchState): HomeSessionSearchTransition {
  return { state, effects: NONE }
}

function unchanged(state: HomeSessionSearchState): HomeSessionSearchTransition {
  return { state, effects: NONE }
}
