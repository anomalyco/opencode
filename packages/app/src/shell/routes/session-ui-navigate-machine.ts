import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"

/** The screen that asked to open a session: a result lands only while the user is still there. */
export type SessionNavigateOrigin = {
  readonly server: ServerConnection.Key
  readonly sessionID: string | undefined
}

/**
 * Opening a session from the timeline: a subagent card syncs the child before it navigates, so the parent stays on
 * screen meanwhile; a session ID in Markdown is looked up on this server before it opens a tab. One at a time: the
 * latest click wins, and leaving the screen drops it.
 */
export type SessionUINavigateState =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "resolving"
      readonly kind: "child" | "referenced"
      readonly attempt: number
      readonly origin: SessionNavigateOrigin
      readonly targetSessionID: string
    }
  | { readonly status: "disposed" }

export type SessionUINavigateEvent =
  | { readonly type: "child.requested"; readonly origin: SessionNavigateOrigin; readonly targetSessionID: string }
  /** The sync settled, either way: the session route shows the child, or its error, from there. */
  | { readonly type: "child.synced"; readonly attempt: number }
  | { readonly type: "referenced.requested"; readonly origin: SessionNavigateOrigin; readonly targetSessionID: string }
  | { readonly type: "referenced.resolved"; readonly attempt: number; readonly session: SessionInfo }
  | { readonly type: "referenced.missing"; readonly attempt: number }
  | { readonly type: "referenced.failed"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "origin.changed"; readonly origin: SessionNavigateOrigin }
  | { readonly type: "disposed" }

export type SessionUINavigateEffect =
  | { readonly type: "child.sync"; readonly attempt: number; readonly targetSessionID: string }
  | { readonly type: "child.navigate"; readonly origin: SessionNavigateOrigin; readonly targetSessionID: string }
  | { readonly type: "referenced.lookup"; readonly attempt: number; readonly targetSessionID: string }
  | { readonly type: "referenced.abort"; readonly attempt: number }
  | { readonly type: "referenced.open"; readonly server: ServerConnection.Key; readonly session: SessionInfo }
  | { readonly type: "toast.not-found" }
  | { readonly type: "toast.request-failed"; readonly cause: unknown }

export type SessionUINavigateTransition = {
  readonly state: SessionUINavigateState
  readonly effects: readonly SessionUINavigateEffect[]
}

const NO_EFFECTS: readonly never[] = Object.freeze([])

export const INITIAL_SESSION_UI_NAVIGATE_STATE: SessionUINavigateState = Object.freeze({ status: "idle", attempt: 0 })

const DISPOSED: SessionUINavigateState = Object.freeze({ status: "disposed" })

export function transitionSessionUINavigate(
  state: SessionUINavigateState,
  event: SessionUINavigateEvent,
): SessionUINavigateTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") return { state: DISPOSED, effects: abort(state) }

  if (event.type === "origin.changed") {
    if (state.status === "idle" || sameOrigin(state.origin, event.origin)) return { state, effects: NO_EFFECTS }

    return { state: { status: "idle", attempt: state.attempt }, effects: abort(state) }
  }

  if (event.type === "child.requested" || event.type === "referenced.requested") {
    const kind = event.type === "child.requested" ? "child" : "referenced"

    // The session on screen needs no opening, and a repeat click joins the one in flight.
    if (kind === "child" && event.origin.sessionID === event.targetSessionID) return { state, effects: NO_EFFECTS }

    if (
      state.status === "resolving" &&
      state.kind === kind &&
      state.targetSessionID === event.targetSessionID &&
      sameOrigin(state.origin, event.origin)
    )
      return { state, effects: NO_EFFECTS }
    const attempt = state.attempt + 1

    return {
      state: { status: "resolving", kind, attempt, origin: event.origin, targetSessionID: event.targetSessionID },
      effects: [
        ...abort(state),
        kind === "child"
          ? { type: "child.sync", attempt, targetSessionID: event.targetSessionID }
          : { type: "referenced.lookup", attempt, targetSessionID: event.targetSessionID },
      ],
    }
  }

  if (state.status !== "resolving" || state.attempt !== event.attempt) return { state, effects: NO_EFFECTS }

  const idle: SessionUINavigateState = { status: "idle", attempt: state.attempt }

  if (event.type === "child.synced")
    return state.kind === "child"
      ? {
          state: idle,
          effects: [{ type: "child.navigate", origin: state.origin, targetSessionID: state.targetSessionID }],
        }
      : { state, effects: NO_EFFECTS }

  if (state.kind !== "referenced") return { state, effects: NO_EFFECTS }

  if (event.type === "referenced.resolved")
    return { state: idle, effects: [{ type: "referenced.open", server: state.origin.server, session: event.session }] }

  if (event.type === "referenced.missing") return { state: idle, effects: [{ type: "toast.not-found" }] }

  return { state: idle, effects: [{ type: "toast.request-failed", cause: event.cause }] }
}

function sameOrigin(a: SessionNavigateOrigin, b: SessionNavigateOrigin) {
  return a.server === b.server && a.sessionID === b.sessionID
}

function abort(state: SessionUINavigateState): readonly SessionUINavigateEffect[] {
  return state.status === "resolving" && state.kind === "referenced"
    ? [{ type: "referenced.abort", attempt: state.attempt }]
    : NO_EFFECTS
}
