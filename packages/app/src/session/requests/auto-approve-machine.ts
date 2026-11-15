export const AUTO_APPROVE_RETRY_LIMIT = 2

export const AUTO_APPROVE_RETRY_DELAY_MS = 1000

// A reply hides its request from the dock while it runs, so one that never answers gives up on this attempt instead.
// Retrying is safe: the server answers a request it already settled with not found, which the data layer counts as
// replied.
export const AUTO_APPROVE_REPLY_TIMEOUT_MS = 15_000

// One sweep lists active sessions and then every location's requests through the shared request queue, so it gets
// more time than one reply before it counts as failed and retries.
export const AUTO_APPROVE_SWEEP_TIMEOUT_MS = 30_000

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
  | { readonly type: "reply.timed-out"; readonly runId: string; readonly attempt: number }
  | { readonly type: "retry.due"; readonly runId: string; readonly attempt: number }
  | { readonly type: "cancel" }
  | { readonly type: "resolved" }

export type AutoApproveEffect =
  | {
      readonly type: "reply"
      readonly sessionID: string
      readonly runId: string
      readonly attempt: number
      readonly timeoutMs: number
    }
  // Stops waiting on the current reply. The request itself runs on; `runId` and `attempt` fence its late result.
  | { readonly type: "clear-reply-timer" }
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

    return changed({ status: "replied" }, stop(state))
  }

  // Turning auto-approve off ends the cycle, so a reply still in flight settles into nothing and schedules no retry.
  if (event.type === "cancel") {
    if (state.status === "pending" || state.status === "replied") return unchanged(state)

    return changed(INITIAL_AUTO_APPROVE_STATE, stop(state))
  }

  // Store scans and sweeps approve repeatedly; only a request no cycle owns starts one. An exhausted request stays
  // surfaced until someone answers it or auto-approve is turned off and on again.
  if (event.type === "approve") {
    if (state.status !== "pending") return unchanged(state)

    return changed(
      { status: "replying", sessionID: event.sessionID, projectID: event.projectID, runId: event.runId, attempt: 0 },
      [reply(event.sessionID, event.runId, 0)],
    )
  }

  if (event.type === "reply.succeeded") {
    if (state.status !== "replying" || !current(state, event)) return unchanged(state)

    return changed({ status: "replied" }, [{ type: "clear-reply-timer" }])
  }

  if (event.type === "reply.failed" || event.type === "reply.timed-out") {
    if (state.status !== "replying" || !current(state, event)) return unchanged(state)

    if (state.attempt >= AUTO_APPROVE_RETRY_LIMIT)
      return changed({ status: "gave-up", projectID: state.projectID }, [{ type: "clear-reply-timer" }])
    const attempt = state.attempt + 1

    return changed({ ...state, status: "waiting-retry", attempt }, [
      { type: "clear-reply-timer" },
      { type: "schedule-retry", runId: state.runId, attempt, delayMs: AUTO_APPROVE_RETRY_DELAY_MS * attempt },
    ])
  }

  if (state.status !== "waiting-retry" || !current(state, event)) return unchanged(state)

  return changed({ ...state, status: "replying" }, [reply(state.sessionID, state.runId, state.attempt)])
}

// Whether a pending request waits on the user, so the permission dock shows it and every badge counts it.
// Auto-approve hides it only while a cycle can still answer it.
export function needsUser(state: AutoApproveState, autoApprove: boolean) {
  if (state.status === "replied") return false

  if (state.status === "gave-up") return true

  return !autoApprove
}

// The connect sweep of one server: it finds requests asked while this client was disconnected, or before auto-approve
// turned on. A finished and an exhausted sweep both rest in `idle`; nothing tells them apart until the next start.
export type AutoApproveSweepState =
  | { readonly status: "idle" }
  | { readonly status: "sweeping"; readonly runId: string; readonly attempt: number }
  | { readonly status: "waiting-retry"; readonly runId: string; readonly attempt: number }

export type AutoApproveSweepEvent =
  | { readonly type: "sweep.start"; readonly runId: string }
  | { readonly type: "sweep.succeeded"; readonly runId: string; readonly attempt: number }
  | { readonly type: "sweep.failed"; readonly runId: string; readonly attempt: number }
  | { readonly type: "sweep.timed-out"; readonly runId: string; readonly attempt: number }
  | { readonly type: "sweep.retry-due"; readonly runId: string; readonly attempt: number }
  | { readonly type: "sweep.cancel" }

export type AutoApproveSweepEffect =
  | { readonly type: "sweep.run"; readonly runId: string; readonly attempt: number; readonly timeoutMs: number }
  // Stops the current sweep's requests and its timeout.
  | { readonly type: "sweep.abort" }
  | {
      readonly type: "sweep.schedule-retry"
      readonly runId: string
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "sweep.cancel-retry" }

export type AutoApproveSweepTransition = {
  readonly state: AutoApproveSweepState
  readonly effects: readonly AutoApproveSweepEffect[]
}

export const INITIAL_AUTO_APPROVE_SWEEP_STATE: AutoApproveSweepState = Object.freeze({ status: "idle" })

export function transitionAutoApproveSweep(
  state: AutoApproveSweepState,
  event: AutoApproveSweepEvent,
): AutoApproveSweepTransition {
  // A newer connect or setting change replaces the sweep in progress, or the retry it waits for.
  if (event.type === "sweep.start")
    return sweepChanged({ status: "sweeping", runId: event.runId, attempt: 0 }, [
      ...stopSweep(state),
      run(event.runId, 0),
    ])

  if (event.type === "sweep.cancel") {
    if (state.status === "idle") return sweepUnchanged(state)

    return sweepChanged(INITIAL_AUTO_APPROVE_SWEEP_STATE, stopSweep(state))
  }

  if (event.type === "sweep.retry-due") {
    if (state.status !== "waiting-retry" || !current(state, event)) return sweepUnchanged(state)

    return sweepChanged({ status: "sweeping", runId: state.runId, attempt: state.attempt }, [
      run(state.runId, state.attempt),
    ])
  }

  if (state.status !== "sweeping" || !current(state, event)) return sweepUnchanged(state)

  // An incomplete sweep leaves pending requests hidden with no later trigger to recover them, so it retries a bounded
  // number of times.
  if (event.type === "sweep.succeeded" || state.attempt >= AUTO_APPROVE_RETRY_LIMIT)
    return sweepChanged(INITIAL_AUTO_APPROVE_SWEEP_STATE, [{ type: "sweep.abort" }])
  const attempt = state.attempt + 1

  return sweepChanged({ status: "waiting-retry", runId: state.runId, attempt }, [
    { type: "sweep.abort" },
    { type: "sweep.schedule-retry", runId: state.runId, attempt, delayMs: AUTO_APPROVE_RETRY_DELAY_MS * attempt },
  ])
}

function reply(sessionID: string, runId: string, attempt: number): AutoApproveEffect {
  return { type: "reply", sessionID, runId, attempt, timeoutMs: AUTO_APPROVE_REPLY_TIMEOUT_MS }
}

function stop(state: AutoApproveState): AutoApproveEffect[] {
  if (state.status === "replying") return [{ type: "clear-reply-timer" }]

  if (state.status === "waiting-retry") return [{ type: "cancel-retry" }]

  return []
}

function run(runId: string, attempt: number): AutoApproveSweepEffect {
  return { type: "sweep.run", runId, attempt, timeoutMs: AUTO_APPROVE_SWEEP_TIMEOUT_MS }
}

function stopSweep(state: AutoApproveSweepState): AutoApproveSweepEffect[] {
  if (state.status === "sweeping") return [{ type: "sweep.abort" }]

  if (state.status === "waiting-retry") return [{ type: "sweep.cancel-retry" }]

  return []
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

function sweepChanged(
  state: AutoApproveSweepState,
  effects: readonly AutoApproveSweepEffect[] = [],
): AutoApproveSweepTransition {
  return { state, effects }
}

function sweepUnchanged(state: AutoApproveSweepState): AutoApproveSweepTransition {
  return { state, effects: [] }
}
