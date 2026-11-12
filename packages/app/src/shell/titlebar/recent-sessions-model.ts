import type { SessionInfo } from "@opencode/client/promise"
import { ServerConnection } from "@/runtime/server/registry"
import { mergeHomeSessionIndex } from "@/home/sessions/index"

const separator = "\u0000"

export const RECENT_PAGE_LIMIT = 50

/** Bounds a hanging server request; matches the Home session list's fetch deadline. */
export const RECENT_PAGE_TIMEOUT_MS = 30_000

export type RecentSession = {
  /** `${server}\u0000${sessionID}`, the same key the pin order stores. */
  key: string
  server: string
  session: SessionInfo
}

export function recentSessionKey(server: string, sessionID: string) {
  return `${server}${separator}${sessionID}`
}

// Tabs and saved pins address a connection. For display, two routes to the same endpoint refer to one session.
export function recentSessionEndpoints(connections: readonly ServerConnection.Any[], ownUrl: string | undefined) {
  return new Map<string, string>(
    connections.map((conn) => {
      const key = ServerConnection.key(conn)
      const endpoint = ServerConnection.local(conn, ownUrl) ? "sidecar" : ServerConnection.http(conn)?.url

      return [key, endpoint ?? key]
    }),
  )
}

export function splitRecentSessionKey(key: string) {
  const index = key.indexOf(separator)

  if (index === -1) return

  return { server: key.slice(0, index), sessionID: key.slice(index + 1) }
}

/** Pins append to the end; pinning an existing session keeps its place. */
export function addPin(pins: readonly string[], key: string) {
  return pins.includes(key) ? [...pins] : [...pins, key]
}

export function removePin(pins: readonly string[], key: string, endpoints: ReadonlyMap<string, string>) {
  const target = splitRecentSessionKey(key)

  return pins.filter((pin) => {
    if (pin === key) return false
    const other = splitRecentSessionKey(pin)

    if (!target || !other || other.sessionID !== target.sessionID) return true

    return (endpoints.get(other.server) ?? other.server) !== (endpoints.get(target.server) ?? target.server)
  })
}

/** Drops duplicate and malformed keys, keeping the first occurrence of each. */
export function dedupePins(pins: readonly string[]) {
  return [...new Set(pins)].filter((key) => {
    const parsed = splitRecentSessionKey(key)

    return !!parsed?.sessionID
  })
}

/**
 * Applies a new relative order for the pins a list shows, keeping pins it hides (archived sessions) in their slots.
 * Returns the current order when the visible keys are not the same set.
 */
export function reorderPins(pins: readonly string[], visible: readonly string[], nextVisible: readonly string[]) {
  if (nextVisible.length !== visible.length) return [...pins]

  if (new Set(nextVisible).size !== nextVisible.length) return [...pins]

  const shown = new Set(visible)

  if (nextVisible.some((key) => !shown.has(key))) return [...pins]

  let index = 0

  return pins.map((pin) => (shown.has(pin) ? nextVisible[index++] : pin))
}

/** Recent sessions sort by their latest activity, then by ID so equal timestamps keep one stable order. */
export function compareRecentSessions(a: RecentSession, b: RecentSession) {
  const updated =
    (b.session.time.updated ?? b.session.time.created) - (a.session.time.updated ?? a.session.time.created)

  if (updated !== 0) return updated

  if (a.session.id !== b.session.id) return a.session.id < b.session.id ? -1 : 1

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export function sortRecentSessions(items: readonly RecentSession[]) {
  return [...items].sort(compareRecentSessions)
}

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Rows Recent shows at first, and how many more each Show more reveals. */
export const RECENT_VISIBLE_LIMIT = 30

/**
 * Recent shows the sessions active in the last 7 days, at most 30. Each Show more reveals `RECENT_VISIBLE_LIMIT`
 * more regardless of age. `serversHaveMore` says whether any server still has pages that were not fetched.
 */
export function windowRecentSessions(input: {
  items: readonly RecentSession[]
  now: number
  revealed: number
  serversHaveMore: boolean
}) {
  const cutoff = input.now - RECENT_WINDOW_MS
  const older = input.items.findIndex((item) => sessionTime(item.session) < cutoff)
  const inWindow = older === -1 ? input.items.length : older
  const limit = Math.min(inWindow, RECENT_VISIBLE_LIMIT) + input.revealed
  const visible = input.items.slice(0, limit)

  return { visible, limit, hasMore: input.items.length > visible.length || input.serversHaveMore }
}

type RecentPageBase = {
  readonly sessions: readonly SessionInfo[]
  readonly cursor: string | undefined
  readonly exhausted: boolean
  readonly olderLoaded: boolean
}

/** One server's fetched pages. `loading.kind` decides how a response joins the rows already held. */
export type RecentPageState =
  | ({ readonly status: "idle" } & RecentPageBase)
  | ({
      readonly status: "loading"
      readonly kind: "first" | "next" | "refresh"
      readonly attempt: number
    } & RecentPageBase)
  | ({ readonly status: "ready" } & RecentPageBase)
  | ({ readonly status: "failed"; readonly kind: "first" | "next" | "refresh" } & RecentPageBase)

export type RecentPageEvent =
  | { readonly type: "load"; readonly kind: "first" | "next" | "refresh"; readonly attempt: number }
  | { readonly type: "retry"; readonly attempt: number }
  | {
      readonly type: "succeeded"
      readonly attempt: number
      readonly sessions: readonly SessionInfo[]
      readonly next: string | undefined
    }
  | { readonly type: "failed"; readonly attempt: number }
  | { readonly type: "timed-out"; readonly attempt: number }
  | { readonly type: "removed" }

export type RecentPageEffect =
  | { readonly type: "fetch"; readonly attempt: number; readonly cursor: string | undefined }
  | { readonly type: "timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.cancel" }

export type RecentPageTransition = {
  readonly state: RecentPageState
  readonly effects: readonly RecentPageEffect[]
}

type LoadingRecentPageState = Extract<RecentPageState, { status: "loading" }>

export const INITIAL_RECENT_PAGE_STATE: RecentPageState = {
  status: "idle",
  sessions: [],
  cursor: undefined,
  exhausted: false,
  olderLoaded: false,
}

const NO_EFFECTS: readonly RecentPageEffect[] = []

function unchanged(state: RecentPageState): RecentPageTransition {
  return { state, effects: NO_EFFECTS }
}

function sessionTime(session: SessionInfo) {
  return session.time.updated ?? session.time.created
}

function mergeSessions(current: readonly SessionInfo[], next: readonly SessionInfo[]) {
  return [...new Map([...current, ...next].map((session) => [session.id, session] as const)).values()]
}

function startLoading(state: RecentPageState, kind: "first" | "next" | "refresh", attempt: number) {
  const requestCursor = kind === "next" ? state.cursor : undefined
  const cursor = kind === "first" ? undefined : state.cursor

  return {
    state: {
      status: "loading",
      kind,
      attempt,
      sessions: kind === "first" ? [] : state.sessions,
      cursor,
      exhausted: kind === "first" ? false : state.exhausted,
      olderLoaded: kind === "first" ? false : state.olderLoaded,
    } satisfies RecentPageState,
    effects: [
      { type: "fetch", attempt, cursor: requestCursor },
      { type: "timer.start", attempt, delayMs: RECENT_PAGE_TIMEOUT_MS },
    ] satisfies readonly RecentPageEffect[],
  }
}

function finishLoading(
  state: LoadingRecentPageState,
  event: Extract<RecentPageEvent, { type: "succeeded" }>,
): RecentPageTransition {
  const incoming = [...event.sessions]
  // The server returns an anchor for every non-empty page, including a short final page.
  const next = incoming.length < RECENT_PAGE_LIMIT ? undefined : event.next

  if (state.kind === "next") {
    return {
      state: {
        status: "ready",
        sessions: mergeSessions(state.sessions, incoming),
        cursor: next,
        exhausted: !next,
        olderLoaded: true,
      },
      effects: [{ type: "timer.cancel" }],
    }
  }

  if (state.kind === "first" || !state.olderLoaded) {
    return {
      state: {
        status: "ready",
        sessions: incoming,
        cursor: next,
        exhausted: !next,
        olderLoaded: false,
      },
      effects: [{ type: "timer.cancel" }],
    }
  }

  // A reconnect snapshot with older pages loaded. A short final page replaces the list; an empty overlap means the
  // snapshot starts fresh; otherwise rows in page one's window that the snapshot dropped are ghosts.
  if (!next) {
    return {
      state: { status: "ready", sessions: incoming, cursor: undefined, exhausted: true, olderLoaded: false },
      effects: [{ type: "timer.cancel" }],
    }
  }

  const oldest = incoming.reduce((oldest, session) => Math.min(oldest, sessionTime(session)), Infinity)

  if (oldest > state.sessions.reduce((newest, session) => Math.max(newest, sessionTime(session)), -Infinity)) {
    return {
      state: { status: "ready", sessions: incoming, cursor: next, exhausted: false, olderLoaded: false },
      effects: [{ type: "timer.cancel" }],
    }
  }

  const incomingIDs = new Set(incoming.map((session) => session.id))
  const kept = state.sessions.filter((session) => sessionTime(session) < oldest || incomingIDs.has(session.id))

  return {
    state: {
      status: "ready",
      sessions: mergeSessions(kept, incoming),
      cursor: state.cursor,
      exhausted: state.exhausted,
      olderLoaded: true,
    },
    effects: [{ type: "timer.cancel" }],
  }
}

/** One server's page lifecycle. I/O lives in the driver; this only says what to fetch and what the rows become. */
export function transitionRecentPage(
  state: RecentPageState,
  event: RecentPageEvent,
): RecentPageTransition {
  if (event.type === "removed") {
    return { state: INITIAL_RECENT_PAGE_STATE, effects: [{ type: "timer.cancel" }] }
  }

  if (event.type === "load") {
    if (event.kind === "next") {
      if (state.status !== "ready" && state.status !== "failed") return unchanged(state)

      if (state.cursor === undefined || state.exhausted) return unchanged(state)
    }

    return startLoading(state, event.kind, event.attempt)
  }

  if (event.type === "retry") {
    if (state.status !== "failed") return unchanged(state)

    return startLoading(state, state.kind, event.attempt)
  }

  if (state.status !== "loading" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "succeeded") return finishLoading(state, event)

  if (event.type === "failed" || event.type === "timed-out") {
    return {
      state: {
        status: "failed",
        kind: state.kind,
        sessions: state.sessions,
        cursor: state.cursor,
        exhausted: state.exhausted,
        olderLoaded: state.olderLoaded,
      },
      effects: [{ type: "timer.cancel" }],
    }
  }

  return unchanged(state)
}

export function recentPageLoaded(state: RecentPageState | undefined) {
  return !!state && (state.status === "ready" || state.status === "failed")
}

export function recentPageFailed(state: RecentPageState | undefined) {
  return state?.status === "failed"
}

export function recentPageHasMore(state: RecentPageState | undefined) {
  return !!state && (state.status === "ready" || state.status === "failed") && !state.exhausted && !!state.cursor
}

/** One server's sessions plus the live store, keeping root, unarchived sessions. Live entries win. */
export function mergeRecentSessions(
  server: string,
  fetched: readonly SessionInfo[],
  known: readonly SessionInfo[],
  apply: (rows: SessionInfo[]) => SessionInfo[] = (rows) => rows,
) {
  const sessions = apply(mergeHomeSessionIndex(fetched, known))

  return sortRecentSessions(sessions.map((session) => ({ key: recentSessionKey(server, session.id), server, session })))
}

/**
 * Pinned sessions keep their stored order and leave Recent. A pin whose session is archived is hidden but kept;
 * one that is not loaded yet resolves through `resolvePin`.
 */
export function partitionRecentSessions(input: {
  hidden?: (server: string, id: string) => boolean
  items: readonly RecentSession[]
  pins: readonly string[]
  endpoints: ReadonlyMap<string, string>
  open: ReadonlySet<string>
  resolvePin: (key: string) => RecentSession | undefined
  archived: (key: string) => boolean
}) {
  const byKey = new Map(input.items.map((item) => [item.key, item] as const))

  const identity = (item: RecentSession) =>
    recentSessionKey(input.endpoints.get(item.server) ?? item.server, item.session.id)

  const pinnedSessions = new Set<string>()

  const pinned = input.pins.flatMap((key): RecentSession[] => {
    if (input.archived(key)) return []
    const item = byKey.get(key) ?? input.resolvePin(key)

    if (!item || item.session.time.archived !== undefined) return []

    if (input.hidden?.(item.server, item.session.id)) return []

    const id = identity(item)

    if (pinnedSessions.has(id)) return []
    pinnedSessions.add(id)

    return [item]
  })

  const pinnedKeys = new Set(input.pins)
  const recent = new Map<string, RecentSession>()

  // Opening a row should reuse an existing tab. Otherwise prefer a stable route regardless of fetch order.
  for (const item of input.items) {
    if (input.hidden?.(item.server, item.session.id)) continue
    const id = identity(item)

    if (pinnedKeys.has(item.key) || pinnedSessions.has(id)) continue

    const previous = recent.get(id)

    if (!previous) {
      recent.set(id, item)
      continue
    }

    const open = input.open.has(item.key)
    const previousOpen = input.open.has(previous.key)

    if (open !== previousOpen ? open : item.key < previous.key) recent.set(id, item)
  }

  return { pinned, recent: sortRecentSessions([...recent.values()]) }
}

export function recentRowUnread(unread: boolean, loading: boolean, muted: boolean) {
  return unread && !loading && !muted
}
