import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { messagesBeforeRevert, type RevertBoundary } from "@opencode/client/solid"
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

/**
 * The boundary the event stream reports for a revert request this machine sent: the staged message, or `undefined` for
 * a clear. Echoes stay in send order until the stream reports them, so a late echo of an earlier request is not taken
 * for a change made elsewhere.
 */
export type RevertEcho = string | undefined

export type SessionRevertOperation =
  /** An undelivered prompt has no history to rewind, so it is withdrawn from the inbox instead. */
  | {
      readonly type: "withdraw"
      readonly message: SessionMessageUser
      /** The prompt before it, found while it is still in the transcript. */
      readonly cursor: string | undefined
    }
  | { readonly type: "rewind"; readonly message: SessionMessageUser; readonly prior: string | undefined }
  | { readonly type: "redo" }
  /** The Rewound toast's Undo: restage the earlier boundary and put the draft from before the rewind back. */
  | { readonly type: "undo-rewind"; readonly prior: string | undefined; readonly draft: RevertDraftSnapshot }

// One Session's rewind, undo and redo. `attempt` advances whenever an operation starts, so a late request result or a
// click on an older Rewound toast is ignored.
export type SessionRevertState =
  | {
      readonly status: "idle"
      readonly attempt: number
      readonly echoes: readonly RevertEcho[]
      readonly known?: KnownRevert
    }
  | {
      readonly status: "running"
      readonly attempt: number
      readonly echoes: readonly RevertEcho[]
      readonly operation: SessionRevertOperation
      readonly known?: KnownRevert
    }
  /** A rewind landed and its toast can undo it. */
  | {
      readonly status: "restored"
      readonly attempt: number
      readonly echoes: readonly RevertEcho[]
      readonly boundary: string
      readonly prior: string | undefined
      readonly draft: RevertDraftSnapshot
    }

/** The Session's user messages when a request or result is dispatched. */
type RevertMessages = {
  /** The whole transcript: the boundary can be any message type, so it's cut before taking the prompts. */
  readonly messages: readonly SessionMessageInfo[]
  /** Messages still waiting in the inbox. */
  readonly inboxIDs: ReadonlySet<string>
}

export type SessionRevertEvent =
  | ({
      readonly type: "rewind.to"
      readonly messageID: string
      readonly revert: RevertBoundary | undefined
    } & RevertMessages)
  | ({ readonly type: "undo.requested"; readonly revert: RevertBoundary | undefined } & RevertMessages)
  | { readonly type: "redo.requested"; readonly revert: RevertBoundary | undefined }
  | { readonly type: "toast.undo"; readonly attempt: number }
  | { readonly type: "withdraw.succeeded"; readonly attempt: number; readonly prompt: Prompt }
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
  return { status: "idle", attempt: 0, echoes: [] }
}

export function transitionSessionRevert(state: SessionRevertState, event: SessionRevertEvent): SessionRevertTransition {
  if (event.type === "rewind.to") {
    if (state.status === "running") return unchanged(state)
    const message = prompts(event.messages).find((item) => item.id === event.messageID)

    if (!message) return unchanged(state)

    return start(state, rewindOrWithdraw(message, event, effectiveRevert(state, event.revert)?.messageID))
  }

  if (event.type === "undo.requested") {
    if (state.status === "running") return unchanged(state)
    const boundary = effectiveRevert(state, event.revert)
    const message = prompts(event.messages, boundary).at(-1)

    if (!message) return unchanged(state)

    return start(state, rewindOrWithdraw(message, event, boundary?.messageID))
  }

  if (event.type === "redo.requested") {
    if (state.status === "running" || !effectiveRevert(state, event.revert)) return unchanged(state)

    return start(state, { type: "redo" })
  }

  if (event.type === "toast.undo") {
    if (state.status !== "restored" || event.attempt !== state.attempt) return unchanged(state)

    return start(state, { type: "undo-rewind", prior: state.prior, draft: state.draft })
  }

  if (event.type === "withdraw.succeeded") {
    if (state.status !== "running" || state.attempt !== event.attempt || state.operation.type !== "withdraw")
      return unchanged(state)

    return changed(idle(state.attempt, state.echoes, state.known), [
      { type: "draft.restoreMessage", message: state.operation.message, prompt: event.prompt },
      { type: "cursor.select", messageID: state.operation.cursor },
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
        echoes: state.echoes,
        boundary: message.id,
        prior: state.operation.prior,
        draft: event.draft,
      },
      [
        { type: "draft.restoreMessage", message },
        { type: "cursor.select", messageID: selectCursorAfterRevert(event, { messageID: message.id }) },
        { type: "toast.showRewound", attempt: state.attempt },
      ],
    )
  }

  if (event.type === "redo.succeeded") {
    if (state.status !== "running" || state.attempt !== event.attempt || state.operation.type !== "redo")
      return unchanged(state)

    return changed(idle(state.attempt, state.echoes, { boundary: undefined }), [
      { type: "cursor.select", messageID: selectCursorAfterRevert(event, undefined) },
    ])
  }

  if (event.type === "undo-rewind.succeeded") {
    if (state.status !== "running" || state.attempt !== event.attempt || state.operation.type !== "undo-rewind")
      return unchanged(state)
    const operation = state.operation

    return changed(idle(state.attempt, state.echoes, { boundary: operation.prior }), [
      { type: "draft.restoreSnapshot", draft: operation.draft },
      {
        type: "cursor.select",
        messageID: selectCursorAfterRevert(event, operation.prior ? { messageID: operation.prior } : undefined),
      },
    ])
  }

  if (event.type === "operation.failed") {
    if (state.status !== "running" || state.attempt !== event.attempt) return unchanged(state)

    return changed(idle(state.attempt, withoutEcho(state.echoes, state.operation), state.known), [
      { type: "toast.fail", error: event.error },
    ])
  }

  // A request that timed out may still land; its echo then arrives as a change from elsewhere and the store follows it.
  if (event.type === "operation.timed-out") {
    if (state.status !== "running" || state.attempt !== event.attempt) return unchanged(state)

    return changed(idle(state.attempt, withoutEcho(state.echoes, state.operation), state.known), [
      { type: "operation.abort" },
      { type: "toast.fail" },
    ])
  }

  if (event.type === "disposed") {
    if (state.status === "idle") return unchanged(state)

    return changed(idle(state.attempt, []), [
      { type: state.status === "running" ? "operation.abort" : "toast.dismiss" },
    ])
  }

  const echo =
    event.type === "revert.committed"
      ? -1
      : state.echoes.indexOf(event.type === "revert.staged" ? event.messageID : undefined)

  // The stream reported a request this machine sent, so a restored rewind keeps its toast. The store lags until the
  // echo of the last request arrives, so the known boundary stays until then.
  if (echo >= 0) {
    const echoes = state.echoes.slice(echo + 1)

    if (state.status === "restored" || echoes.length > 0) return changed({ ...state, echoes })

    return changed(forget(state, echoes))
  }

  // A stage or clear from elsewhere, or a sent prompt committing the revert: the stream is the source of truth again.
  // A commit lands after every request already sent, but a running operation may still be interrupting or waiting,
  // so its own echo stays due. Echoes drain in order, so a pending one at the end is always the running operation's.
  const echoes =
    event.type !== "revert.committed"
      ? state.echoes
      : state.status === "running" && state.operation.type !== "withdraw"
        ? state.echoes.slice(-1)
        : []

  // A newer boundary replaced this rewind, so its Undo would restore a stale draft.
  if (state.status === "restored") return changed(idle(state.attempt, echoes), [{ type: "toast.dismiss" }])

  if (!state.known && echoes === state.echoes) return unchanged(state)

  return changed(forget(state, echoes))
}

/**
 * The revert boundary the Session has, counting requests that settled before the event stream reported them. Only
 * the server's own boundary carries its `seq`; another one is found in the loaded transcript.
 */
export function effectiveRevert(state: SessionRevertState, server: RevertBoundary | undefined) {
  const messageID =
    state.status === "restored" ? state.boundary : state.known ? state.known.boundary : server?.messageID

  if (!messageID) return undefined

  return messageID === server?.messageID ? server : { messageID }
}

/** The prompt before the boundary, or the latest delivered prompt when nothing is reverted. */
export function selectCursorAfterRevert(input: RevertMessages, boundary: RevertBoundary | undefined) {
  if (boundary) return prompts(input.messages, boundary).at(-1)?.id

  return prompts(input.messages)
    .filter((item) => !input.inboxIDs.has(item.id))
    .at(-1)?.id
}

export function viewSessionRevert(
  state: SessionRevertState,
  context: { readonly messages: readonly SessionMessageInfo[]; readonly revert: RevertBoundary | undefined },
) {
  const busy = state.status === "running"
  const revert = effectiveRevert(state, context.revert)

  return {
    busy,
    revertMessageID: revert?.messageID,
    canUndo: !busy && prompts(context.messages, revert).length > 0,
    canRedo: !busy && !!revert,
  }
}

/** The prompts before the boundary, cut first because the boundary can be any message type. */
function prompts(messages: readonly SessionMessageInfo[], boundary?: RevertBoundary) {
  return (boundary ? messagesBeforeRevert(messages, boundary) : messages).filter(
    (item): item is SessionMessageUser => item.type === "user",
  )
}

function rewindOrWithdraw(
  message: SessionMessageUser,
  input: RevertMessages,
  prior: string | undefined,
): SessionRevertOperation {
  if (input.inboxIDs.has(message.id))
    return { type: "withdraw", message, cursor: selectCursorAfterRevert(input, { messageID: message.id }) }

  return { type: "rewind", message, prior }
}

// Claims the Session synchronously, so a second request before the first await is refused.
function start(state: SessionRevertState, operation: SessionRevertOperation): SessionRevertTransition {
  const attempt = state.attempt + 1
  const known = state.status === "restored" ? { boundary: state.boundary } : state.known
  // The echo is expected from the moment the request is sent: the stream can report it before the response lands.
  const echoes = operation.type === "withdraw" ? state.echoes : [...state.echoes, echoOf(operation)]
  const run: SessionRevertEffect = { type: "operation.run", attempt, operation }

  return changed(
    known
      ? { status: "running", attempt, echoes, operation, known }
      : { status: "running", attempt, echoes, operation },
    state.status === "restored" ? [{ type: "toast.dismiss" }, run] : [run],
  )
}

function echoOf(operation: Exclude<SessionRevertOperation, { type: "withdraw" }>): RevertEcho {
  if (operation.type === "rewind") return operation.message.id

  if (operation.type === "undo-rewind") return operation.prior

  return undefined
}

// A request that failed sends no echo.
function withoutEcho(echoes: readonly RevertEcho[], operation: SessionRevertOperation) {
  if (operation.type === "withdraw") return echoes
  const index = echoes.lastIndexOf(echoOf(operation))

  return index < 0 ? echoes : echoes.filter((_, at) => at !== index)
}

function forget(
  state: Exclude<SessionRevertState, { status: "restored" }>,
  echoes: readonly RevertEcho[],
): SessionRevertState {
  if (state.status === "idle") return idle(state.attempt, echoes)

  return { status: "running", attempt: state.attempt, echoes, operation: state.operation }
}

function idle(attempt: number, echoes: readonly RevertEcho[], known?: KnownRevert): SessionRevertState {
  return known ? { status: "idle", attempt, echoes, known } : { status: "idle", attempt, echoes }
}

function changed(state: SessionRevertState, effects: readonly SessionRevertEffect[] = []): SessionRevertTransition {
  return { state, effects }
}

function unchanged(state: SessionRevertState): SessionRevertTransition {
  return { state, effects: [] }
}
