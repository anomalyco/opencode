export const AUTO_APPROVE_RETRY_LIMIT = 2

export const AUTO_APPROVE_RETRY_DELAY_MS = 1000

// One permission request's auto-approve lifecycle. `runId` names one approval cycle and `attempt` one reply within
// it, so a reply or timer from a cancelled or resolved cycle can never move a later one.
export type AutoApproveState =
  | { readonly status: "pending" }
  | {
      readonly status: "replying"
      readonly sessionID: string
      readonly projectID: string | undefined
      readonly runId: string
      readonly attempt: number
    }
  | {
      readonly status: "waiting-retry"
      readonly sessionID: string
      readonly projectID: string | undefined
      readonly runId: string
      readonly attempt: number
    }
  | { readonly status: "replied" }
  | { readonly status: "gave-up"; readonly projectID: string | undefined }

export type AutoApproveEvent =
  | {
      readonly type: "approve"
      readonly sessionID: string
      readonly projectID: string | undefined
      readonly runId: string
    }
  | { readonly type: "reply.succeeded"; readonly runId: string; readonly attempt: number }
  | { readonly type: "reply.failed"; readonly runId: string; readonly attempt: number }
  | { readonly type: "retry.due"; readonly runId: string; readonly attempt: number }
  | { readonly type: "cancel" }
  | { readonly type: "resolved" }

export type AutoApproveEffect =
  | { readonly type: "reply"; readonly sessionID: string; readonly runId: string; readonly attempt: number }
  | { readonly type: "schedule-retry"; readonly runId: string; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-retry" }

export type AutoApproveTransition = {
  readonly state: AutoApproveState
  readonly effects: readonly AutoApproveEffect[]
}

export const INITIAL_AUTO_APPROVE_STATE: AutoApproveState = { status: "pending" }

export function transitionAutoApprove(state: AutoApproveState, event: AutoApproveEvent): AutoApproveTransition {
  // A request nobody tried to approve has nothing to settle when another client answers it.
  if (event.type === "resolved") {
    if (state.status === "pending" || state.status === "replied") return unchanged(state)

    return changed({ status: "replied" }, state.status === "waiting-retry" ? [{ type: "cancel-retry" }] : [])
  }

  if (event.type === "cancel") {
    if (state.status === "pending" || state.status === "replied") return unchanged(state)

    return changed(INITIAL_AUTO_APPROVE_STATE, state.status === "waiting-retry" ? [{ type: "cancel-retry" }] : [])
  }

  // Store scans and sweeps approve repeatedly; only a request no cycle owns starts one. An exhausted request stays
  // surfaced until someone answers it or auto-approve is turned off and on again.
  if (event.type === "approve") {
    if (state.status !== "pending") return unchanged(state)

    return changed(
      { status: "replying", sessionID: event.sessionID, projectID: event.projectID, runId: event.runId, attempt: 0 },
      [{ type: "reply", sessionID: event.sessionID, runId: event.runId, attempt: 0 }],
    )
  }

  if (event.type === "reply.succeeded") {
    if (state.status !== "replying" || !current(state, event)) return unchanged(state)

    return changed({ status: "replied" })
  }

  if (event.type === "reply.failed") {
    if (state.status !== "replying" || !current(state, event)) return unchanged(state)

    if (state.attempt >= AUTO_APPROVE_RETRY_LIMIT) return changed({ status: "gave-up", projectID: state.projectID })
    const attempt = state.attempt + 1

    return changed({ ...state, status: "waiting-retry", attempt }, [
      { type: "schedule-retry", runId: state.runId, attempt, delayMs: AUTO_APPROVE_RETRY_DELAY_MS * attempt },
    ])
  }

  if (state.status !== "waiting-retry" || !current(state, event)) return unchanged(state)

  return changed({ ...state, status: "replying" }, [
    { type: "reply", sessionID: state.sessionID, runId: state.runId, attempt: state.attempt },
  ])
}

// Whether a pending request waits on the user, so the permission dock shows it and every badge counts it.
// Auto-approve hides it only while a cycle can still answer it.
export function needsUser(state: AutoApproveState, autoApprove: boolean) {
  if (state.status === "replied") return false

  if (state.status === "gave-up") return true

  return !autoApprove
}

function current(state: { runId: string; attempt: number }, event: { runId: string; attempt: number }) {
  return state.runId === event.runId && state.attempt === event.attempt
}

function changed(state: AutoApproveState, effects: readonly AutoApproveEffect[] = []): AutoApproveTransition {
  return { state, effects }
}

function unchanged(state: AutoApproveState): AutoApproveTransition {
  return { state, effects: [] }
}
