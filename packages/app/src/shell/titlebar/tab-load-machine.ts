import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import type { PendingSession, TabInfo } from "@/shell/tabs/tabs"

export const SESSION_TAB_LOAD_TIMEOUT_MS = 15_000

/** What the tab strip knows about one session tab, read in one synchronous pass. */
export type SessionTabSnapshot = {
  readonly key: string
  readonly server: ServerConnection.Key
  readonly sessionID: string
  readonly active: boolean
  readonly pending: boolean
  readonly cached: boolean
  readonly missing: boolean
  readonly persistedTitle: boolean
  readonly serverReady: boolean
  readonly connected: boolean
}

/**
 * A session tab's fetch. Only tabs that need their session have an entry: the active tab, and any tab without a stored
 * title. `unavailable` means the fetch failed or timed out without the server reporting the session missing; it
 * retries once the connection comes back.
 */
export type SessionTabLoad =
  | { readonly phase: "loading"; readonly attempt: number }
  | { readonly phase: "unavailable"; readonly connected: boolean }

export type SessionTabLoadsState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly entries: Readonly<Record<string, SessionTabLoad>>
    }
  | { readonly status: "disposed" }

export type SessionTabLoadsEvent =
  | { readonly type: "sync"; readonly tabs: readonly SessionTabSnapshot[] }
  | {
      readonly type: "load.settled"
      readonly key: string
      readonly attempt: number
      readonly cached: boolean
      readonly missing: boolean
      readonly connected: boolean
    }
  | { readonly type: "load.timed-out"; readonly key: string; readonly attempt: number; readonly connected: boolean }
  | { readonly type: "disposed" }

export type SessionTabLoadsEffect =
  | {
      readonly type: "load.start"
      readonly key: string
      readonly server: ServerConnection.Key
      readonly sessionID: string
      readonly attempt: number
      readonly timeoutMs: number
    }
  | { readonly type: "load.clear"; readonly attempt: number }

export type SessionTabLoadsTransition = {
  readonly state: SessionTabLoadsState
  readonly effects: readonly SessionTabLoadsEffect[]
}

export type SessionTabViewInput = {
  readonly active: boolean
  readonly pending: PendingSession | undefined
  readonly session: SessionInfo | undefined
  readonly missing: boolean
  readonly persisted: TabInfo | undefined
  readonly serverReady: boolean
}

export type SessionTabView = {
  readonly phase: "preparing" | "loaded" | "missing" | "deferred" | "waiting-server" | "unavailable" | "loading"
  readonly visible: boolean
  readonly session: SessionInfo | undefined
  /** `session` is the generic session label, `unknown` the label of a session that could not be loaded. */
  readonly fallbackTitle: "session" | "persisted" | "unknown" | "none"
  readonly fallbackDirectory: string | undefined
}

const EMPTY_ENTRIES: Readonly<Record<string, SessionTabLoad>> = Object.freeze({})

export const INITIAL_SESSION_TAB_LOADS_STATE: SessionTabLoadsState = Object.freeze({
  status: "active",
  issued: 0,
  entries: EMPTY_ENTRIES,
})

const DISPOSED: SessionTabLoadsState = Object.freeze({ status: "disposed" })

export function transitionSessionTabLoads(
  state: SessionTabLoadsState,
  event: SessionTabLoadsEvent,
): SessionTabLoadsTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED, effects: clearAll(state.entries, () => true) }

  if (event.type === "sync") return sync(state, event.tabs)
  const entry = state.entries[event.key]

  if (entry?.phase !== "loading" || entry.attempt !== event.attempt) return unchanged(state)
  const clear = { type: "load.clear", attempt: event.attempt } as const

  // A loaded or missing session leaves the entry: the tab reads both from the session cache.
  if (event.type === "load.settled" && (event.cached || event.missing))
    return { state: { ...state, entries: without(state.entries, event.key) }, effects: [clear] }

  return {
    state: {
      ...state,
      entries: { ...state.entries, [event.key]: { phase: "unavailable", connected: event.connected } },
    },
    effects: [clear],
  }
}

/** How a session tab shows, derived in the same pass as the tab strip's visible order. */
export function selectSessionTabView(
  state: SessionTabLoadsState,
  key: string,
  input: SessionTabViewInput,
): SessionTabView {
  const persisted = input.persisted?.title ? "persisted" : undefined

  if (input.pending)
    return {
      phase: "preparing",
      visible: true,
      session: undefined,
      fallbackTitle: "session",
      fallbackDirectory: input.pending.draft.directory ?? input.persisted?.directory,
    }

  const view = (phase: SessionTabView["phase"], visible: boolean, fallbackTitle: SessionTabView["fallbackTitle"]) => ({
    phase,
    visible,
    session: input.session,
    fallbackTitle,
    fallbackDirectory: input.persisted?.directory,
  })

  if (input.session) return view("loaded", true, persisted ?? "none")

  if (input.missing) return view("missing", true, persisted ?? "unknown")

  // A background tab with a stored title shows it without fetching its session.
  if (!input.active && persisted) return view("deferred", true, persisted)

  if (!input.serverReady) return view("waiting-server", !!persisted, persisted ?? "none")

  if (state.status === "active" && state.entries[key]?.phase === "unavailable")
    return view("unavailable", true, persisted ?? "unknown")

  return view("loading", !!persisted, persisted ?? "none")
}

function sync(
  state: Extract<SessionTabLoadsState, { status: "active" }>,
  tabs: readonly SessionTabSnapshot[],
): SessionTabLoadsTransition {
  const effects: SessionTabLoadsEffect[] = []
  const entries: Record<string, SessionTabLoad> = {}
  const keep = new Set<string>()
  let issued = state.issued

  tabs.forEach((tab) => {
    const needed = !tab.pending && !tab.cached && !tab.missing && (tab.active || !tab.persistedTitle) && tab.serverReady

    if (!needed) return
    keep.add(tab.key)
    const entry = state.entries[tab.key]

    if (entry?.phase === "loading") {
      entries[tab.key] = entry

      return
    }

    // A failure while connected waits for a reconnect, or for the tab to be activated again.
    if (entry?.phase === "unavailable" && (entry.connected || !tab.connected)) {
      entries[tab.key] = entry.connected === tab.connected ? entry : { phase: "unavailable", connected: tab.connected }

      return
    }

    issued += 1
    entries[tab.key] = { phase: "loading", attempt: issued }
    effects.push({
      type: "load.start",
      key: tab.key,
      server: tab.server,
      sessionID: tab.sessionID,
      attempt: issued,
      timeoutMs: SESSION_TAB_LOAD_TIMEOUT_MS,
    })
  })

  const cleared = clearAll(state.entries, (key) => !keep.has(key))
  const keys = Object.keys(entries)

  if (
    effects.length === 0 &&
    keys.length === Object.keys(state.entries).length &&
    keys.every((key) => entries[key] === state.entries[key])
  )
    return unchanged(state)

  return {
    state: { status: "active", issued, entries: keys.length === 0 ? EMPTY_ENTRIES : entries },
    effects: [...cleared, ...effects],
  }
}

function clearAll(entries: Readonly<Record<string, SessionTabLoad>>, match: (key: string) => boolean) {
  return Object.entries(entries).flatMap(([key, entry]) =>
    entry.phase === "loading" && match(key) ? [{ type: "load.clear" as const, attempt: entry.attempt }] : [],
  )
}

function without(entries: Readonly<Record<string, SessionTabLoad>>, key: string) {
  const next = Object.fromEntries(Object.entries(entries).filter(([item]) => item !== key))

  return Object.keys(next).length === 0 ? EMPTY_ENTRIES : next
}

function unchanged(state: SessionTabLoadsState): SessionTabLoadsTransition {
  return { state, effects: [] }
}
