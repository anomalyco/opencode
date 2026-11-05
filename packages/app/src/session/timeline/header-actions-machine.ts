/** A rename that has not settled by then counts as failed, so the title input cannot stay disabled. */
export const SESSION_RENAME_TIMEOUT_MS = 15_000

/** A delete that has not settled by then counts as failed, so the dialog's buttons cannot stay disabled. */
export const SESSION_DELETE_TIMEOUT_MS = 15_000

/**
 * The session header's title: shown, with its options menu open, edited inline, or saving the edit. `renaming`: Rename
 * was chosen and the menu is closing; the editor opens once the menu hands focus back, so the menu cannot take focus
 * from it. Opening the menu again drops that, so a later, unrelated menu close never opens the editor.
 */
export type SessionHeaderTitleState =
  | { readonly status: "idle"; readonly sessionKey: string; readonly attempt: number }
  | { readonly status: "menu"; readonly sessionKey: string; readonly attempt: number }
  | { readonly status: "renaming"; readonly sessionKey: string; readonly attempt: number }
  | { readonly status: "editing"; readonly sessionKey: string; readonly attempt: number; readonly draft: string }
  | {
      readonly status: "saving"
      readonly sessionKey: string
      readonly attempt: number
      readonly sessionID: string
      readonly draft: string
    }
  | { readonly status: "disposed" }

/** `editable`: a selected root session, whose title the header may rename. */
export type SessionHeaderTitleEvent =
  | { readonly type: "target.synced"; readonly sessionKey: string; readonly editable: boolean }
  | { readonly type: "menu.toggled"; readonly open: boolean; readonly editable: boolean }
  | { readonly type: "rename.chosen" }
  /** The closing menu hands focus back. */
  | { readonly type: "menu.closed"; readonly editable: boolean; readonly title: string }
  | { readonly type: "edit.opened"; readonly editable: boolean; readonly title: string }
  | { readonly type: "draft.changed"; readonly value: string }
  | { readonly type: "edit.cancelled" }
  | {
      readonly type: "edit.submitted"
      readonly sessionID: string | undefined
      readonly editable: boolean
      readonly currentTitle: string
    }
  | { readonly type: "rename.succeeded"; readonly attempt: number }
  | { readonly type: "rename.failed"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "rename.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SessionHeaderTitleEffect =
  | { readonly type: "focus.schedule"; readonly attempt: number }
  | { readonly type: "focus.cancel" }
  | { readonly type: "rename.save"; readonly attempt: number; readonly sessionID: string; readonly title: string }
  | { readonly type: "timer.start"; readonly attempt: number }
  | { readonly type: "timer.cancel" }
  | { readonly type: "toast.rename-failed"; readonly cause?: unknown }

export type SessionHeaderTitleTransition = {
  readonly state: SessionHeaderTitleState
  readonly effects: readonly SessionHeaderTitleEffect[]
}

/** The delete confirmation for one session: asking, or waiting for the server. */
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

const TIMER_CANCEL = Object.freeze({ type: "timer.cancel" } as const)

const FOCUS_CANCEL: SessionHeaderTitleEffect = Object.freeze({ type: "focus.cancel" })

const DIALOG_CLOSE: SessionDeleteEffect = Object.freeze({ type: "dialog.close" })

const TITLE_DISPOSED: SessionHeaderTitleState = Object.freeze({ status: "disposed" })

export function createSessionHeaderTitleState(sessionKey: string): SessionHeaderTitleState {
  return { status: "idle", sessionKey, attempt: 0 }
}

export function transitionSessionHeaderTitle(
  state: SessionHeaderTitleState,
  event: SessionHeaderTitleEvent,
): SessionHeaderTitleTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") return { state: TITLE_DISPOSED, effects: cleanupTitle(state) }

  // Another session, or one the header may no longer rename, leaves the editor. A save still in flight lands on the
  // server and in the session list, but no longer closes an editor.
  if (event.type === "target.synced") {
    if (event.sessionKey === state.sessionKey && (event.editable || state.status === "idle"))
      return { state, effects: NO_EFFECTS }

    return {
      state: { status: "idle", sessionKey: event.sessionKey, attempt: state.attempt + 1 },
      effects: cleanupTitle(state),
    }
  }

  if (event.type === "menu.toggled") {
    // Opening the menu again drops a Rename whose menu never handed focus back.
    if (event.open && (state.status === "idle" || state.status === "renaming") && event.editable)
      return { state: rest(state, "menu"), effects: NO_EFFECTS }

    if (!event.open && state.status === "menu") return { state: rest(state, "idle"), effects: NO_EFFECTS }

    return { state, effects: NO_EFFECTS }
  }

  // The menu may report closing before or after the item it closed for.
  if (event.type === "rename.chosen")
    return state.status === "menu" || state.status === "idle"
      ? { state: rest(state, "renaming"), effects: NO_EFFECTS }
      : { state, effects: NO_EFFECTS }

  if (event.type === "menu.closed") {
    if (state.status !== "renaming") return { state, effects: NO_EFFECTS }

    return event.editable ? edit(state, event.title) : { state: rest(state, "idle"), effects: NO_EFFECTS }
  }

  if (event.type === "edit.opened") {
    if (!event.editable || (state.status !== "idle" && state.status !== "menu" && state.status !== "renaming"))
      return { state, effects: NO_EFFECTS }

    return edit(state, event.title)
  }

  if (event.type === "draft.changed")
    return state.status === "editing" && event.value !== state.draft
      ? { state: { ...state, draft: event.value }, effects: NO_EFFECTS }
      : { state, effects: NO_EFFECTS }

  if (event.type === "edit.cancelled")
    return state.status === "editing"
      ? { state: rest(state, "idle"), effects: [FOCUS_CANCEL] }
      : { state, effects: NO_EFFECTS }

  // Enter, then the blur it causes, submits once: the first leaves `editing`.
  if (event.type === "edit.submitted") {
    if (state.status !== "editing") return { state, effects: NO_EFFECTS }
    const title = state.draft.trim()

    if (!event.editable || !event.sessionID || !title || title === event.currentTitle)
      return { state: rest(state, "idle"), effects: [FOCUS_CANCEL] }
    const attempt = state.attempt + 1

    return {
      state: {
        status: "saving",
        sessionKey: state.sessionKey,
        attempt,
        sessionID: event.sessionID,
        draft: state.draft,
      },
      effects: [
        FOCUS_CANCEL,
        { type: "rename.save", attempt, sessionID: event.sessionID, title },
        { type: "timer.start", attempt },
      ],
    }
  }

  if (state.status !== "saving" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (event.type === "rename.succeeded") return { state: rest(state, "idle"), effects: [TIMER_CANCEL] }

  // A failed save keeps the edit, so the user can retry or cancel it.
  const attempt = state.attempt + 1

  return {
    state: { status: "editing", sessionKey: state.sessionKey, attempt, draft: state.draft },
    effects: [
      TIMER_CANCEL,
      { type: "toast.rename-failed", cause: event.type === "rename.failed" ? event.cause : undefined },
      { type: "focus.schedule", attempt },
    ],
  }
}

export function selectSessionHeaderTitleView(state: SessionHeaderTitleState) {
  const editing = state.status === "editing" || state.status === "saving"

  return {
    editing,
    saving: state.status === "saving",
    draft: editing ? state.draft : "",
    menuOpen: state.status === "menu",
    // The closing menu would return focus to its trigger; after Rename, the editor takes it instead.
    editOnMenuClose: state.status === "renaming",
  }
}

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

function rest(state: Exclude<SessionHeaderTitleState, { status: "disposed" }>, status: "idle" | "menu" | "renaming") {
  return { status, sessionKey: state.sessionKey, attempt: state.attempt + 1 }
}

function edit(state: Exclude<SessionHeaderTitleState, { status: "disposed" }>, title: string) {
  const attempt = state.attempt + 1

  return {
    state: { status: "editing", sessionKey: state.sessionKey, attempt, draft: title },
    effects: [{ type: "focus.schedule", attempt }],
  } satisfies SessionHeaderTitleTransition
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

function cleanupTitle(
  state: Exclude<SessionHeaderTitleState, { status: "disposed" }>,
): readonly SessionHeaderTitleEffect[] {
  if (state.status === "editing") return [FOCUS_CANCEL]

  if (state.status === "saving") return [TIMER_CANCEL]

  return NO_EFFECTS
}
