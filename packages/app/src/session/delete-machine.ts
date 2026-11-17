/** A delete that has not settled by then counts as failed, so the dialog's buttons cannot stay disabled. */
export const SESSION_DELETE_TIMEOUT_MS = 15_000

/** The delete confirmation for one session, in the session header or on Home: asking, or waiting for the server. */
export type SessionDeleteState =
  | { readonly status: "confirming"; readonly sessionID: string; readonly attempt: number }
  | {
      readonly status: "deleting"
      readonly sessionID: string
      readonly attempt: number
      readonly target: SessionDeleteTarget
    }
  | { readonly status: "closed"; readonly sessionID: string; readonly attempt: number }
  | { readonly status: "disposed"; readonly sessionID: string; readonly attempt: number }

/** Read when the user confirms, before the delete hides the session from the list. */
export type SessionDeleteTarget = {
  readonly parentID?: string
  readonly nextID?: string
  readonly removedIDs: readonly string[]
}

export type SessionDeleteEvent =
  | { readonly type: "cancel.requested" }
  /** `target`: undefined once the session is gone. */
  | { readonly type: "confirm.requested"; readonly target: SessionDeleteTarget | undefined }
  | { readonly type: "delete.succeeded"; readonly attempt: number; readonly target: SessionDeleteTarget }
  | { readonly type: "delete.failed"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "delete.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SessionDeleteEffect =
  | {
      readonly type: "delete.run"
      readonly attempt: number
      readonly sessionID: string
      readonly target: SessionDeleteTarget
    }
  | { readonly type: "timer.start"; readonly attempt: number }
  | { readonly type: "timer.cancel" }
  | { readonly type: "dialog.close" }
  | { readonly type: "session.removed"; readonly sessionID: string; readonly target: SessionDeleteTarget }
  | { readonly type: "toast.delete-failed"; readonly cause?: unknown }

export type SessionDeleteTransition = {
  readonly state: SessionDeleteState
  readonly effects: readonly SessionDeleteEffect[]
}

const NO_EFFECTS: readonly never[] = Object.freeze([])

const TIMER_CANCEL: SessionDeleteEffect = Object.freeze({ type: "timer.cancel" })

const DIALOG_CLOSE: SessionDeleteEffect = Object.freeze({ type: "dialog.close" })

export function createSessionDeleteState(sessionID: string): SessionDeleteState {
  return { status: "confirming", sessionID, attempt: 0 }
}

export function transitionSessionDelete(state: SessionDeleteState, event: SessionDeleteEvent): SessionDeleteTransition {
  if (state.status === "closed" || state.status === "disposed") {
    // The server deleted the session after the dialog went: it still leaves the session and its tabs.
    if (event.type === "delete.succeeded")
      return { state, effects: [{ type: "session.removed", sessionID: state.sessionID, target: event.target }] }

    return { state, effects: NO_EFFECTS }
  }

  if (event.type === "disposed")
    return {
      state: { status: "disposed", sessionID: state.sessionID, attempt: state.attempt + 1 },
      effects: state.status === "deleting" ? [TIMER_CANCEL] : NO_EFFECTS,
    }

  if (state.status === "confirming") {
    // A delete that timed out can still land; the session is gone, so the dialog goes too.
    if (event.type === "delete.succeeded") return deleted(state, event.target)

    if (event.type === "cancel.requested" || (event.type === "confirm.requested" && !event.target))
      return { state: { ...state, status: "closed", attempt: state.attempt + 1 }, effects: [DIALOG_CLOSE] }

    if (event.type !== "confirm.requested" || !event.target) return { state, effects: NO_EFFECTS }
    const attempt = state.attempt + 1

    return {
      state: { status: "deleting", sessionID: state.sessionID, attempt, target: event.target },
      effects: [
        { type: "delete.run", attempt, sessionID: state.sessionID, target: event.target },
        { type: "timer.start", attempt },
      ],
    }
  }

  // A second click, Enter or Cancel waits for the delete in flight.
  if (event.type !== "delete.succeeded" && event.type !== "delete.failed" && event.type !== "delete.timed-out")
    return { state, effects: NO_EFFECTS }

  if (event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (event.type === "delete.succeeded") return deleted(state, event.target)

  // A failed delete keeps the dialog, so the user can retry or cancel.
  return {
    state: { status: "confirming", sessionID: state.sessionID, attempt: state.attempt + 1 },
    effects: [
      TIMER_CANCEL,
      { type: "toast.delete-failed", cause: event.type === "delete.failed" ? event.cause : undefined },
    ],
  }
}

export function selectSessionDeleteView(state: SessionDeleteState) {
  return { busy: state.status !== "confirming" }
}

function deleted(
  state: Extract<SessionDeleteState, { status: "confirming" | "deleting" }>,
  target: SessionDeleteTarget,
): SessionDeleteTransition {
  return {
    state: { status: "closed", sessionID: state.sessionID, attempt: state.attempt + 1 },
    effects: [
      ...(state.status === "deleting" ? [TIMER_CANCEL] : []),
      DIALOG_CLOSE,
      { type: "session.removed", sessionID: state.sessionID, target },
    ],
  }
}
