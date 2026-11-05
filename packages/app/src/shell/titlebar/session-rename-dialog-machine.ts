/** How long the dialog waits for a save before it gives control back. The request itself keeps running. */
export const SESSION_RENAME_SAVE_TIMEOUT_MS = 15_000

/**
 * The sidebar's rename dialog. `initial` is the title the server last confirmed. `closed` means the dialog is playing
 * its exit animation.
 */
export type SessionRenameDialogState =
  | {
      readonly status: "editing"
      readonly issued: number
      readonly initial: string
      readonly draft: string
      /** True once the first focus selected the title, so a later focus keeps the user's caret. */
      readonly selected: boolean
    }
  | {
      readonly status: "saving"
      readonly issued: number
      readonly attempt: number
      readonly initial: string
      readonly draft: string
    }
  | { readonly status: "closed"; readonly issued: number }
  | { readonly status: "disposed"; readonly issued: number }

export type SessionRenameDialogEvent =
  | { readonly type: "input.focused" }
  | { readonly type: "input.changed"; readonly value: string }
  | { readonly type: "submitted" }
  | { readonly type: "cancelled" }
  | { readonly type: "save.succeeded"; readonly attempt: number; readonly title: string }
  | { readonly type: "save.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "save.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type SessionRenameDialogEffect =
  | { readonly type: "input.select" }
  | { readonly type: "input.focus" }
  | { readonly type: "save.start"; readonly attempt: number; readonly title: string; readonly timeoutMs: number }
  | { readonly type: "timer.clear"; readonly attempt: number }
  | { readonly type: "dialog.close" }
  | { readonly type: "toast.failed"; readonly error: unknown }

export type SessionRenameDialogTransition = {
  readonly state: SessionRenameDialogState
  readonly effects: readonly SessionRenameDialogEffect[]
}

export function createSessionRenameDialogState(initial: string): SessionRenameDialogState {
  return { status: "editing", issued: 0, initial, draft: initial, selected: false }
}

const NONE: readonly SessionRenameDialogEffect[] = []

export function transitionSessionRenameDialog(
  state: SessionRenameDialogState,
  event: SessionRenameDialogEvent,
): SessionRenameDialogTransition {
  if (state.status === "disposed" || state.status === "closed") {
    if (event.type !== "disposed" || state.status === "disposed") return unchanged(state)

    return { state: { status: "disposed", issued: state.issued }, effects: NONE }
  }

  const clear: readonly SessionRenameDialogEffect[] =
    state.status === "saving" ? [{ type: "timer.clear", attempt: state.attempt }] : NONE

  // Closing stops waiting but does not take back a save already sent: if it lands, the caller still shows the title.
  if (event.type === "disposed") return { state: { status: "disposed", issued: state.issued }, effects: clear }

  if (event.type === "cancelled")
    return { state: { status: "closed", issued: state.issued }, effects: [...clear, { type: "dialog.close" }] }

  if (event.type === "save.succeeded") return saveSucceeded(state, event)

  if (event.type === "save.failed" || event.type === "save.timed-out") {
    if (state.status !== "saving" || state.attempt !== event.attempt) return unchanged(state)

    return {
      state: { status: "editing", issued: state.issued, initial: state.initial, draft: state.draft, selected: true },
      effects: [
        { type: "timer.clear", attempt: event.attempt },
        { type: "toast.failed", error: event.type === "save.failed" ? event.error : undefined },
        { type: "input.focus" },
      ],
    }
  }

  if (state.status === "saving") return unchanged(state)

  if (event.type === "input.focused") {
    if (state.selected) return unchanged(state)

    return { state: { ...state, selected: true }, effects: [{ type: "input.select" }] }
  }

  if (event.type === "input.changed") {
    if (event.value === state.draft) return unchanged(state)

    return { state: { ...state, draft: event.value }, effects: NONE }
  }
  const title = state.draft.trim()

  if (!title) return unchanged(state)

  if (title === state.initial) return { state: { status: "closed", issued: state.issued }, effects: [{ type: "dialog.close" }] }
  const attempt = state.issued + 1

  return {
    state: { status: "saving", issued: attempt, attempt, initial: state.initial, draft: state.draft },
    effects: [{ type: "save.start", attempt, title, timeoutMs: SESSION_RENAME_SAVE_TIMEOUT_MS }],
  }
}

export function selectSessionRenameDialogView(state: SessionRenameDialogState) {
  const draft = state.status === "editing" || state.status === "saving" ? state.draft : ""

  return {
    draft,
    saving: state.status === "saving",
    inputDisabled: state.status !== "editing",
    // Cancel stays usable while a save is slow.
    cancelDisabled: state.status !== "editing" && state.status !== "saving",
    canSubmit: state.status === "editing" && draft.trim().length > 0,
  }
}

function saveSucceeded(
  state: Extract<SessionRenameDialogState, { status: "editing" | "saving" }>,
  event: Extract<SessionRenameDialogEvent, { type: "save.succeeded" }>,
): SessionRenameDialogTransition {
  if (event.attempt < 1 || event.attempt > state.issued) return unchanged(state)

  if (state.status === "saving") {
    // A newer save is in flight and decides the outcome.
    if (state.attempt !== event.attempt) return unchanged(state)

    return {
      state: { status: "closed", issued: state.issued },
      effects: [{ type: "timer.clear", attempt: event.attempt }, { type: "dialog.close" }],
    }
  }

  // A save that timed out landed after all. When the draft still asks for that title the rename is done; otherwise
  // the landed title becomes the confirmed one, so submitting it again closes without another request.
  if (state.draft.trim() === event.title)
    return { state: { status: "closed", issued: state.issued }, effects: [{ type: "dialog.close" }] }

  if (state.initial === event.title) return unchanged(state)

  return { state: { ...state, initial: event.title }, effects: NONE }
}

function unchanged(state: SessionRenameDialogState): SessionRenameDialogTransition {
  return { state, effects: NONE }
}
