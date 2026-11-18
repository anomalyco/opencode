import type { ServerConnection } from "@/runtime/server/registry"
import type { LayoutRoute } from "@/shell/state/layout"
import { tabKey, type SessionTab, type Tab } from "@/shell/tabs/tabs"

export type RouteSession = { readonly id: string; readonly parentID?: string }

export type RouteTarget = { readonly server: ServerConnection.Key; readonly sessionID: string }

export type RouteTabSnapshot = {
  readonly route: LayoutRoute
  readonly ready: boolean
  /** The tab that shows the route: its own tab, the preview, or the tab of a cached ancestor. */
  readonly tab: Tab | undefined
  readonly preview: SessionTab | undefined
  readonly recentKey: string | undefined
  /** The routed session's draft promotion is still pending, so the server does not know it yet. */
  readonly pending: boolean
  /** The routed session's cached info, absent while it is pending. */
  readonly session: RouteSession | undefined
  /** The root to open a tab for: the routed session while it is pending, or a root confirmed by the cache. */
  readonly rootID: string | undefined
  readonly serverReady: boolean
}

// Where the routed session stands in the tab strip. `closed` means its tab closed while the route still showed it; it
// is not added again until the route changes.
export type RouteTabPresence = "shown" | "adding" | "missing" | "closed"

// The lookup that refreshes the routed session and finds its root. `held` waits for the server, or for a pending
// promotion to settle.
export type RouteLookup = "held" | "resolving" | "resolved" | "failed"

export type RouteTabState =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "session"
      readonly attempt: number
      readonly target: RouteTarget
      readonly tab: RouteTabPresence
      readonly lookup: RouteLookup
    }
  | { readonly status: "disposed" }

export type RouteTabEvent =
  | { readonly type: "sync"; readonly snapshot: RouteTabSnapshot }
  | {
      readonly type: "resolve.succeeded"
      readonly attempt: number
      readonly target: RouteTarget
      readonly rootID: string
    }
  | { readonly type: "resolve.failed"; readonly attempt: number; readonly target: RouteTarget }
  | { readonly type: "dispose" }

export type RouteTabEffect =
  | { readonly type: "session.resolve"; readonly attempt: number; readonly target: RouteTarget }
  | { readonly type: "attempt.abort"; readonly attempt: number }
  | { readonly type: "tab.add"; readonly server: ServerConnection.Key; readonly sessionID: string }
  | { readonly type: "tab.route"; readonly tab: SessionTab; readonly sessionID: string; readonly parentID?: string }
  | { readonly type: "tab.remember"; readonly tab: Tab }

export type RouteTabTransition = {
  readonly state: RouteTabState
  readonly effects: readonly RouteTabEffect[]
}

type SessionState = Extract<RouteTabState, { status: "session" }>

export const INITIAL_ROUTE_TAB_STATE: RouteTabState = Object.freeze({ status: "idle", attempt: 0 })

const DISPOSED_ROUTE_TAB_STATE: RouteTabState = Object.freeze({ status: "disposed" })

export function transitionRouteTab(state: RouteTabState, event: RouteTabEvent): RouteTabTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "dispose") return { state: DISPOSED_ROUTE_TAB_STATE, effects: abort(state) }

  if (event.type === "sync") return sync(state, event.snapshot)

  if (
    state.status !== "session" ||
    state.lookup !== "resolving" ||
    state.attempt !== event.attempt ||
    !sameTarget(state.target, event.target)
  )
    return unchanged(state)

  if (event.type === "resolve.failed") return changed({ ...state, lookup: "failed" })

  // Only a route without a tab opens its root's; a child whose lookup failed never opens one of its own.
  if (state.tab !== "missing") return changed({ ...state, lookup: "resolved" })

  return changed({ ...state, tab: "adding", lookup: "resolved" }, [
    { type: "tab.add", server: state.target.server, sessionID: event.rootID },
  ])
}

/** Walks the cached ancestors to the root. Returns nothing while an ancestor is missing or the chain loops. */
export function cachedRootID(sessionID: string, get: (sessionID: string) => RouteSession | undefined) {
  const seen = new Set<string>()
  let current = get(sessionID)

  while (current) {
    if (!current.parentID) return current.id

    if (seen.has(current.id)) return
    seen.add(current.id)
    current = get(current.parentID)
  }
}

function sync(state: Exclude<RouteTabState, { status: "disposed" }>, snapshot: RouteTabSnapshot): RouteTabTransition {
  if (!snapshot.ready) return unchanged(state)
  const route = snapshot.route

  if (route.type !== "session") {
    const next = state.status === "idle" ? state : { status: "idle" as const, attempt: state.attempt }

    return changed(next, [...abort(state), ...remember(snapshot)])
  }

  const target = { server: route.server, sessionID: route.sessionId }
  const current = state.status === "session" && sameTarget(state.target, target) ? state : undefined
  const tab = presence(current, snapshot)
  const lookup = current?.lookup ?? "held"
  const start = lookup === "held" && !snapshot.pending && snapshot.serverReady
  const attempt = start ? state.attempt + 1 : state.attempt

  const next: SessionState = {
    status: "session",
    attempt,
    target,
    tab: tab === "missing" && snapshot.rootID ? "adding" : tab,
    lookup: start ? "resolving" : lookup,
  }

  const effects = [
    ...(current ? [] : abort(state)),
    ...(start ? [{ type: "session.resolve" as const, attempt, target }] : []),
    ...(next.tab === "adding" && current?.tab !== "adding" && snapshot.rootID
      ? [{ type: "tab.add" as const, server: route.server, sessionID: snapshot.rootID }]
      : []),
    ...(snapshot.tab ? [...routeTab(snapshot, snapshot.tab), ...remember(snapshot)] : []),
  ]

  if (current && current.tab === next.tab && current.lookup === next.lookup && current.attempt === next.attempt)
    return changed(current, effects)

  return changed(next, effects)
}

function presence(current: SessionState | undefined, snapshot: RouteTabSnapshot): RouteTabPresence {
  if (snapshot.tab) return "shown"

  if (current?.tab === "shown" || current?.tab === "closed") return "closed"

  return current?.tab === "adding" ? "adding" : "missing"
}

// Keeps a session tab's href on the child session it shows. A child is recorded only once its parent is known.
function routeTab(snapshot: RouteTabSnapshot, tab: Tab): RouteTabEffect[] {
  const route = snapshot.route

  if (route.type !== "session" || tab.type !== "session") return []
  const root = route.sessionId === tab.sessionId

  if (!root && snapshot.session?.id !== route.sessionId) return []
  const routeSessionId = root ? undefined : route.sessionId
  const routeParentId = root ? undefined : snapshot.session?.parentID

  if (tab.routeSessionId === routeSessionId && tab.routeParentId === routeParentId) return []

  return [{ type: "tab.route", tab, sessionID: route.sessionId, parentID: routeParentId }]
}

// Remembering a pinned tab also ends any preview, so it applies while a preview is open even if the tab is recent.
function remember(snapshot: RouteTabSnapshot): RouteTabEffect[] {
  const tab = snapshot.tab

  if (!tab) return []
  const key = tabKey(tab)

  if (snapshot.preview && tabKey(snapshot.preview) === key) return []

  if (!snapshot.preview && snapshot.recentKey === key) return []

  return [{ type: "tab.remember", tab }]
}

function abort(state: RouteTabState): RouteTabEffect[] {
  return state.status === "session" && state.lookup === "resolving"
    ? [{ type: "attempt.abort", attempt: state.attempt }]
    : []
}

function sameTarget(a: RouteTarget, b: RouteTarget) {
  return a.server === b.server && a.sessionID === b.sessionID
}

function changed(state: RouteTabState, effects: readonly RouteTabEffect[] = []): RouteTabTransition {
  return { state, effects }
}

function unchanged(state: RouteTabState): RouteTabTransition {
  return { state, effects: [] }
}
