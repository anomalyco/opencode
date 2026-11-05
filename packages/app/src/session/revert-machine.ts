import type { SessionMessageUser } from "@opencode/client/promise"
import type { ContextItem, Prompt } from "@/composer/state"

// A hung wait, media pin or revert request fails, so undo and redo cannot stay disabled forever.
export const REVERT_TIMEOUT_MS = 30_000

export type RevertDraftSnapshot = {
  readonly prompt: Prompt
  readonly cursor: number | undefined
  readonly context: readonly ContextItem[]
}

/** The revert boundary our last settled request left on the server, until the event stream reports it. */
export type KnownRevert = { readonly boundary: string | undefined }

export type SessionRevertOperation =
  /** An undelivered prompt has no history to rewind, so it is withdrawn from the inbox instead. */
  | { readonly type: "withdraw"; readonly message: SessionMessageUser }
  | { readonly type: "rewind"; readonly message: SessionMessageUser; readonly prior: string | undefined }
  | { readonly type: "redo" }
  /** The Rewound toast's Undo: restage the earlier boundary and put the draft from before the rewind back. */
  | { readonly type: "undo-rewind"; readonly prior: string | undefined; readonly draft: RevertDraftSnapshot }

// One Session's rewind, undo and redo. `attempt` advances whenever an operation starts, so a late request result or a
// click on an older Rewound toast is ignored.
export type SessionRevertState =
  | { readonly status: "idle"; readonly attempt: number; readonly known?: KnownRevert }
  | {
      readonly status: "running"
      readonly attempt: number
      readonly operation: SessionRevertOperation
      readonly known?: KnownRevert
    }
  /** A rewind landed and its toast can undo it. */
  | {
      readonly status: "restored"
      readonly attempt: number
      readonly boundary: string
      readonly prior: string | undefined
      readonly draft: RevertDraftSnapshot
    }

/** The Session's user messages when a request or result is dispatched. */
type RevertMessages = {
  readonly messages: readonly SessionMessageUser[]
  /** Messages still waiting in the inbox. */
  readonly inboxIDs: ReadonlySet<string>
}

export type SessionRevertEvent =
  | ({
      readonly type: "rewind.to"
      readonly messageID: string
      readonly revertMessageID: string | undefined
    } & RevertMessages)
  | ({ readonly type: "undo.requested"; readonly revertMessageID: string | undefined } & RevertMessages)
  | { readonly type: "redo.requested"; readonly revertMessageID: string | undefined }
  | { readonly type: "toast.undo"; readonly attempt: number }
  | ({ readonly type: "withdraw.succeeded"; readonly attempt: number; readonly prompt: Prompt } & RevertMessages)
  | ({
      readonly type: "rewind.succeeded"
      readonly attempt: number
      readonly draft: RevertDraftSnapshot
    } & RevertMessages)
  | ({ readonly type: "redo.succeeded"; readonly attempt: number } & RevertMessages)
  | ({ readonly type: "undo-rewind.succeeded"; readonly attempt: number } & RevertMessages)
  | { readonly type: "operation.failed"; readonly attempt: number; readonly error?: string }
  | { readonly type: "operation.timed-out"; readonly attempt: number }
  | { readonly type: "revert.staged"; readonly messageID: string }
  | { readonly type: "revert.cleared" }
  | { readonly type: "revert.committed" }
  | { readonly type: "disposed" }

export type SessionRevertEffect =
  | { readonly type: "operation.run"; readonly attempt: number; readonly operation: SessionRevertOperation }
  | { readonly type: "operation.abort" }
  | { readonly type: "draft.restoreMessage"; readonly message: SessionMessageUser; readonly prompt?: Prompt }
  | { readonly type: "draft.restoreSnapshot"; readonly draft: RevertDraftSnapshot }
  /** The prompt timeline navigation continues from. */
  | { readonly type: "cursor.select"; readonly messageID: string | undefined }
  | { readonly type: "toast.showRewound"; readonly attempt: number }
  | { readonly type: "toast.dismiss" }
  | { readonly type: "toast.fail"; readonly error?: string }

export type SessionRevertTransition = {
  readonly state: SessionRevertState
  readonly effects: readonly SessionRevertEffect[]
}

export function createSessionRevertState(): SessionRevertState {
  return { status: "idle", attempt: 0 }
}

export function transitionSessionRevert(state: SessionRevertState, event: SessionRevertEvent): SessionRevertTransition {
  if (event.type === "rewind.to") {
    if (state.status === "running") return unchanged(state)
    const message = event.messages.find((item) => item.id === event.messageID)

    if (!message) return unchanged(state)

    return start(
      state,
      rewindOrWithdraw(message, event.inboxIDs, effectiveRevertMessageID(state, event.revertMessageID)),
    )
  }

  if (event.type === "undo.requested") {
    if (state.status === "running") return unchanged(state)
    const boundary = effectiveRevertMessageID(state, event.revertMessageID)
    const message = event.messages.filter((item) => !boundary || item.id < boundary).at(-1)

    if (!message) return unchanged(state)

    return start(state, rewindOrWithdraw(message, event.inboxIDs, boundary))
  }

  if (event.type === "redo.requested") {
    if (state.status === "running" || !effectiveRevertMessageID(state, event.revertMessageID)) return unchanged(state)

    return start(state, { type: "redo" })
  }

  if (event.type === "toast.undo") {
    if (state.status !== "restored" || event.attempt !== state.attempt) return unchanged(state)

    return start(state, { type: "undo-rewind", prior: state.prior, draft: state.draft })
  }

  if (event.type === "withdraw.succeeded") {
    if (state.status !== "running" || state.attempt !== event.attempt || state.operation.type !== "withdraw")
      return unchanged(state)
    const message = state.operation.message

    return changed(idle(state.attempt, state.known), [
      { type: "draft.restoreMessage", message, prompt: event.prompt },
      { type: "cursor.select", messageID: selectCursorAfterRevert(event, message.id) },
    ])
  }

  if (event.type === "rewind.succeeded") {
    if (state.status !== "running" || state.attempt !== event.attempt || state.operation.type !== "rewind")
      return unchanged(state)
    const message = state.operation.message

    return changed(
      {
        status: "restored",
        attempt: state.attempt,
        boundary: message.id,
        prior: state.operation.prior,
        draft: event.draft,
      },
      [
        { type: "draft.restoreMessage", message },
        { type: "cursor.select", messageID: selectCursorAfterRevert(event, message.id) },
        { type: "toast.showRewound", attempt: state.attempt },
      ],
    )
  }

  if (event.type === "redo.succeeded") {
    if (state.status !== "running" || state.attempt !== event.attempt || state.operation.type !== "redo")
      return unchanged(state)

    return changed(idle(state.attempt, { boundary: undefined }), [
      { type: "cursor.select", messageID: selectCursorAfterRevert(event, undefined) },
    ])
  }

  if (event.type === "undo-rewind.succeeded") {
    if (state.status !== "running" || state.attempt !== event.attempt || state.operation.type !== "undo-rewind")
      return unchanged(state)
    const operation = state.operation

    return changed(idle(state.attempt, { boundary: operation.prior }), [
      { type: "draft.restoreSnapshot", draft: operation.draft },
      { type: "cursor.select", messageID: selectCursorAfterRevert(event, operation.prior) },
    ])
  }

  if (event.type === "operation.failed") {
    if (state.status !== "running" || state.attempt !== event.attempt) return unchanged(state)

    return changed(idle(state.attempt, state.known), [{ type: "toast.fail", error: event.error }])
  }

  if (event.type === "operation.timed-out") {
    if (state.status !== "running" || state.attempt !== event.attempt) return unchanged(state)

    return changed(idle(state.attempt, state.known), [{ type: "operation.abort" }, { type: "toast.fail" }])
  }

  if (event.type === "disposed") {
    if (state.status === "idle") return unchanged(state)

    return changed(idle(state.attempt), [{ type: state.status === "running" ? "operation.abort" : "toast.dismiss" }])
  }

  // The event stream caught up with the server, so it is the source of truth again.
  if (state.status === "restored") {
    if (event.type === "revert.staged" && event.messageID === state.boundary) return unchanged(state)

    // Another stage, a redo elsewhere or a sent prompt replaced this rewind, so its Undo would restore a stale draft.
    return changed(idle(state.attempt), [{ type: "toast.dismiss" }])
  }

  if (!state.known) return unchanged(state)

  if (state.status === "idle") return changed(idle(state.attempt))

  return changed({ status: "running", attempt: state.attempt, operation: state.operation })
}

/** The revert boundary the Session has, counting requests that settled before the event stream reported them. */
export function effectiveRevertMessageID(state: SessionRevertState, serverRevertMessageID: string | undefined) {
  if (state.status === "restored") return state.boundary

  return state.known ? state.known.boundary : serverRevertMessageID
}

/** The prompt before the boundary, or the latest delivered prompt when nothing is reverted. */
export function selectCursorAfterRevert(input: RevertMessages, boundary: string | undefined) {
  if (boundary) return input.messages.filter((item) => item.id < boundary).at(-1)?.id

  return input.messages.filter((item) => !input.inboxIDs.has(item.id)).at(-1)?.id
}

export function viewSessionRevert(
  state: SessionRevertState,
  context: { readonly messages: readonly SessionMessageUser[]; readonly revertMessageID: string | undefined },
) {
  const busy = state.status === "running"
  const revertMessageID = effectiveRevertMessageID(state, context.revertMessageID)

  return {
    busy,
    revertMessageID,
    canUndo: !busy && context.messages.some((item) => !revertMessageID || item.id < revertMessageID),
    canRedo: !busy && !!revertMessageID,
  }
}

function rewindOrWithdraw(
  message: SessionMessageUser,
  inboxIDs: ReadonlySet<string>,
  prior: string | undefined,
): SessionRevertOperation {
  if (inboxIDs.has(message.id)) return { type: "withdraw", message }

  return { type: "rewind", message, prior }
}

// Claims the Session synchronously, so a second request before the first await is refused.
function start(state: SessionRevertState, operation: SessionRevertOperation): SessionRevertTransition {
  const attempt = state.attempt + 1
  const known = state.status === "restored" ? { boundary: state.boundary } : state.known
  const run: SessionRevertEffect = { type: "operation.run", attempt, operation }

  return changed(
    known ? { status: "running", attempt, operation, known } : { status: "running", attempt, operation },
    state.status === "restored" ? [{ type: "toast.dismiss" }, run] : [run],
  )
}

function idle(attempt: number, known?: KnownRevert): SessionRevertState {
  return known ? { status: "idle", attempt, known } : { status: "idle", attempt }
}

function changed(state: SessionRevertState, effects: readonly SessionRevertEffect[] = []): SessionRevertTransition {
  return { state, effects }
}

function unchanged(state: SessionRevertState): SessionRevertTransition {
  return { state, effects: [] }
}
