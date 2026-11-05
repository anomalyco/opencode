import type { LayoutRoute } from "./layout"
import type { SessionPane, SessionPaneTarget } from "./session-tabs"

/** How long a shortcut's intent waits for the router to arrive at the route it navigates to. */
export const NAVIGATION_INTENT_TIMEOUT_MS = 5_000

/** How long a pane's "+" menu waits for the tab it asked for. */
export const PANE_TARGET_TTL_MS = 10_000

/**
 * Work a shortcut leaves for the screen it opens: Home focuses its session search, a draft opens its project picker.
 * It applies only on `target`, and is dropped once the route goes anywhere else.
 */
export type NavigationIntent =
  | { readonly kind: "none" }
  | {
      readonly kind: "home-search" | "draft-project-search"
      readonly attempt: number
      readonly target: LayoutRoute
      /** The route the shortcut was pressed on, which shows until the navigation commits. */
      readonly origin: LayoutRoute
      readonly entered: boolean
    }

export type PaneTargetEntry = SessionPaneTarget & { readonly attempt: number }

export type LayoutIntentState =
  | {
      readonly status: "active"
      readonly nextAttempt: number
      readonly navigation: NavigationIntent
      readonly paneTargets: Readonly<Record<string, PaneTargetEntry>>
    }
  | { readonly status: "disposed" }

export type LayoutIntentEvent =
  | { readonly type: "home-search.requested"; readonly currentRoute: LayoutRoute }
  | { readonly type: "draft-search.requested"; readonly draftID: string; readonly currentRoute: LayoutRoute }
  | { readonly type: "navigation.taken"; readonly attempt: number }
  | { readonly type: "route.synced"; readonly route: LayoutRoute }
  | { readonly type: "navigation.expired"; readonly attempt: number }
  | { readonly type: "pane.targeted"; readonly session: string; readonly pane: SessionPane; readonly plugin?: string }
  | { readonly type: "pane.consumed"; readonly session: string; readonly attempt: number }
  | { readonly type: "pane.expired"; readonly session: string; readonly attempt: number }
  | { readonly type: "sessions.pruned"; readonly keys: readonly string[] }
  | { readonly type: "disposed" }

export type LayoutIntentEffect =
  | { readonly type: "nav-timer.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "nav-timer.clear" }
  | { readonly type: "pane-timer.start"; readonly session: string; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "pane-timer.clear"; readonly sessions: readonly string[] }

export type LayoutIntentTransition = {
  readonly state: LayoutIntentState
  readonly effects: readonly LayoutIntentEffect[]
}

export const createLayoutIntentState = (): LayoutIntentState => ({
  status: "active",
  nextAttempt: 1,
  navigation: NONE,
  paneTargets: {},
})

const NONE: NavigationIntent = { kind: "none" }

const NO_EFFECTS: readonly LayoutIntentEffect[] = []

const CLEAR_NAV: readonly LayoutIntentEffect[] = [{ type: "nav-timer.clear" }]

export function transitionLayoutIntent(state: LayoutIntentState, event: LayoutIntentEvent): LayoutIntentTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  switch (event.type) {
    case "disposed":
      return {
        state: { status: "disposed" },
        effects: [...CLEAR_NAV, { type: "pane-timer.clear", sessions: Object.keys(state.paneTargets) }],
      }
    case "home-search.requested":
    case "draft-search.requested": {
      const attempt = state.nextAttempt
      const target: LayoutRoute =
        event.type === "home-search.requested" ? { type: "home" } : { type: "draft", draftID: event.draftID }
      const entered = sameRoute(event.currentRoute, target)

      return {
        state: {
          ...state,
          nextAttempt: attempt + 1,
          navigation: {
            kind: event.type === "home-search.requested" ? "home-search" : "draft-project-search",
            attempt,
            target,
            origin: event.currentRoute,
            entered,
          },
        },
        effects: entered ? CLEAR_NAV : [{ type: "nav-timer.start", attempt, timeoutMs: NAVIGATION_INTENT_TIMEOUT_MS }],
      }
    }
    case "navigation.taken":
    case "navigation.expired": {
      if (state.navigation.kind === "none" || state.navigation.attempt !== event.attempt)
        return { state, effects: NO_EFFECTS }

      return {
        state: { ...state, navigation: NONE },
        effects: event.type === "navigation.taken" ? CLEAR_NAV : NO_EFFECTS,
      }
    }
    case "route.synced": {
      const navigation = state.navigation

      if (navigation.kind === "none") return { state, effects: NO_EFFECTS }

      // Arrived: the intent waits for the screen to mount, however long it loads, until the route leaves.
      if (sameRoute(event.route, navigation.target))
        return navigation.entered
          ? { state, effects: NO_EFFECTS }
          : { state: { ...state, navigation: { ...navigation, entered: true } }, effects: CLEAR_NAV }

      // The navigation has not committed yet.
      if (!navigation.entered && sameRoute(event.route, navigation.origin)) return { state, effects: NO_EFFECTS }

      return { state: { ...state, navigation: NONE }, effects: CLEAR_NAV }
    }
    case "pane.targeted": {
      const attempt = state.nextAttempt

      return {
        state: {
          ...state,
          nextAttempt: attempt + 1,
          paneTargets: { ...state.paneTargets, [event.session]: { attempt, pane: event.pane, plugin: event.plugin } },
        },
        effects: [{ type: "pane-timer.start", session: event.session, attempt, timeoutMs: PANE_TARGET_TTL_MS }],
      }
    }
    case "pane.consumed":
    case "pane.expired": {
      if (state.paneTargets[event.session]?.attempt !== event.attempt) return { state, effects: NO_EFFECTS }

      return {
        state: { ...state, paneTargets: omit(state.paneTargets, [event.session]) },
        effects: event.type === "pane.consumed" ? [{ type: "pane-timer.clear", sessions: [event.session] }] : NO_EFFECTS,
      }
    }
    case "sessions.pruned": {
      const sessions = event.keys.filter((key) => key in state.paneTargets)

      if (sessions.length === 0) return { state, effects: NO_EFFECTS }

      return {
        state: { ...state, paneTargets: omit(state.paneTargets, sessions) },
        effects: [{ type: "pane-timer.clear", sessions }],
      }
    }
  }
}

export const navigationPending = (state: LayoutIntentState) =>
  state.status === "active" && state.navigation.kind !== "none"

/** The pending intent of `kind` that `target` may take, or undefined. */
export function selectNavigationIntent(
  state: LayoutIntentState,
  kind: "home-search" | "draft-project-search",
  target: LayoutRoute,
) {
  if (state.status !== "active") return
  const navigation = state.navigation

  if (navigation.kind !== kind || !sameRoute(navigation.target, target)) return

  return navigation
}

export function selectPaneTarget(state: LayoutIntentState, session: string) {
  return state.status === "active" ? state.paneTargets[session] : undefined
}

function omit(targets: Readonly<Record<string, PaneTargetEntry>>, sessions: readonly string[]) {
  return Object.fromEntries(Object.entries(targets).filter(([key]) => !sessions.includes(key)))
}

function sameRoute(a: LayoutRoute, b: LayoutRoute) {
  if (a.type === "draft") return b.type === "draft" && a.draftID === b.draftID

  if (a.type === "session") return b.type === "session" && a.server === b.server && a.sessionId === b.sessionId

  return a.type === b.type
}
