export const PERMISSION_REPLY_TIMEOUT_MS = 15_000

export const PERMISSION_REPLIED_LIMIT = 256

export type PermissionDecision = "once" | "always" | "reject"

// One permission request's manual reply from the dock. `attempt` advances on each try, so a late failure or timeout
// from an earlier click cannot move a newer one. `replied` is terminal: an answered request never re-enables or
// resurfaces before `permission.replied` removes it from the store.
export type PermissionReplyState =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "responding"
      readonly attempt: number
      readonly sessionID: string
      readonly decision: PermissionDecision
    }
  | { readonly status: "replied" }

export type PermissionReplyEvent =
  | { readonly type: "decide"; readonly sessionID: string; readonly decision: PermissionDecision }
  | { readonly type: "reply.succeeded"; readonly attempt: number }
  | { readonly type: "reply.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "reply.timed-out"; readonly attempt: number }
  // `permission.replied` arrived on the event stream, from this or another client.
  | { readonly type: "resolved" }
  | { readonly type: "disposed" }

export type PermissionReplyEffect =
  | {
      readonly type: "reply"
      readonly attempt: number
      readonly sessionID: string
      readonly decision: PermissionDecision
      readonly timeoutMs: number
    }
  | { readonly type: "abort" }
  | { readonly type: "toast-failed"; readonly error?: string }

export type PermissionReplyTransition = {
  readonly state: PermissionReplyState
  readonly effects: readonly PermissionReplyEffect[]
}

export const INITIAL_PERMISSION_REPLY_STATE: PermissionReplyState = Object.freeze({ status: "idle", attempt: 0 })

const NONE: readonly PermissionReplyEffect[] = []

const ABORT: readonly PermissionReplyEffect[] = [{ type: "abort" }]

export function transitionPermissionReply(
  state: PermissionReplyState,
  event: PermissionReplyEvent,
): PermissionReplyTransition {
  // The first click claims the request; later clicks, including a second click of a double-click, do nothing.
  if (event.type === "decide") {
    if (state.status !== "idle") return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "responding", attempt, sessionID: event.sessionID, decision: event.decision },
      effects: [
        {
          type: "reply",
          attempt,
          sessionID: event.sessionID,
          decision: event.decision,
          timeoutMs: PERMISSION_REPLY_TIMEOUT_MS,
        },
      ],
    }
  }

  if (state.status !== "responding") return unchanged(state)

  if (event.type === "resolved") return { state: { status: "replied" }, effects: ABORT }

  if (event.type === "disposed") return { state: { status: "idle", attempt: state.attempt }, effects: ABORT }

  if (event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "reply.succeeded") return { state: { status: "replied" }, effects: ABORT }

  return {
    state: { status: "idle", attempt: state.attempt },
    effects: [
      { type: "abort" },
      { type: "toast-failed", error: event.type === "reply.failed" ? event.error : undefined },
    ],
  }
}

/** The dock's buttons stay disabled while a reply is in flight and after it lands, through the dock's close motion. */
export function isPermissionResponding(state: PermissionReplyState) {
  return state.status !== "idle"
}

/** An answered request leaves the dock at once, without waiting for `permission.replied`. */
export function isPermissionReplied(state: PermissionReplyState) {
  return state.status === "replied"
}

function unchanged(state: PermissionReplyState): PermissionReplyTransition {
  return { state, effects: NONE }
}
