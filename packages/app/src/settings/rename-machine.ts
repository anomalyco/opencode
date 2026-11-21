export const INLINE_RENAME_TIMEOUT_MS = 15_000

/** Account names save when clicking away; project rows discard, as Home session rows do. */
export type InlineRenameBlurPolicy = "submit" | "cancel"

/**
 * An inline rename field in Settings and the menu that opens it. `saving` keeps the draft, so a failed or timed-out save
 * returns to `editing` with it. The field stays focused and read-only while saving, so Escape still cancels.
 */
export type InlineRenameState =
  | { readonly status: "closed"; readonly issued: number }
  | { readonly status: "menu"; readonly issued: number }
  | { readonly status: "editing"; readonly issued: number; readonly draft: string }
  | { readonly status: "saving"; readonly issued: number; readonly attempt: number; readonly draft: string }
  /** `saving`: a save that was in flight; when it lands the owner still hears the field closed. */
  | { readonly status: "disposed"; readonly saving: number | undefined }

export type InlineRenameEvent =
  | { readonly type: "menu.changed"; readonly open: boolean }
  | { readonly type: "started"; readonly value: string }
  | { readonly type: "input"; readonly draft: string }
  /** `currentValue` is the name shown now; submitting it unchanged saves nothing. */
  | { readonly type: "submitted"; readonly currentValue: string }
  | { readonly type: "blurred"; readonly policy: InlineRenameBlurPolicy; readonly currentValue: string }
  | { readonly type: "cancelled" }
  | { readonly type: "save.succeeded"; readonly attempt: number }
  | { readonly type: "save.failed"; readonly attempt: number }
  | { readonly type: "save.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type InlineRenameEffect =
  /** `ifOwned`: only while focus is still on the field, its trigger or nowhere, so a late result never steals focus. */
  | { readonly type: "focus.input"; readonly select: boolean; readonly ifOwned: boolean }
  | { readonly type: "focus.trigger"; readonly ifOwned: boolean }
  | { readonly type: "focus.cancel" }
  | { readonly type: "save.run"; readonly attempt: number; readonly value: string; readonly timeoutMs: number }
  /** Stops waiting for the save; the request itself still finishes. */
  | { readonly type: "save.cancel" }
  | { readonly type: "toast.timeout" }
  | { readonly type: "closed.notify" }

export type InlineRenameTransition = {
  readonly state: InlineRenameState
  readonly effects: readonly InlineRenameEffect[]
}

export const INITIAL_INLINE_RENAME_STATE: InlineRenameState = Object.freeze({ status: "closed", issued: 0 })

const DISPOSED: InlineRenameState = Object.freeze({ status: "disposed", saving: undefined })

const NONE: readonly InlineRenameEffect[] = Object.freeze([])

export function transitionInlineRename(state: InlineRenameState, event: InlineRenameEvent): InlineRenameTransition {
  if (state.status === "disposed") {
    // The list can remount the field while its save is in flight (a refresh rebuilds rows); the saved name still
    // closes the rename its owner keeps open.
    if (event.type === "save.succeeded" && event.attempt === state.saving)
      return { state: DISPOSED, effects: [{ type: "closed.notify" }] }

    return unchanged(state)
  }

  if (event.type === "disposed") {
    return {
      state: state.status === "saving" ? { status: "disposed", saving: state.attempt } : DISPOSED,
      effects: [{ type: "save.cancel" }, { type: "focus.cancel" }],
    }
  }

  if (event.type === "menu.changed") {
    if (state.status === "closed" && event.open) return { state: { status: "menu", issued: state.issued }, effects: NONE }

    if (state.status === "menu" && !event.open) return { state: closed(state), effects: NONE }

    return unchanged(state)
  }

  if (event.type === "started") {
    if (state.status !== "closed" && state.status !== "menu") return unchanged(state)

    return {
      state: { status: "editing", issued: state.issued, draft: event.value },
      effects: [{ type: "focus.input", select: true, ifOwned: false }],
    }
  }

  if (event.type === "input") {
    if (state.status !== "editing" || state.draft === event.draft) return unchanged(state)

    return { state: { ...state, draft: event.draft }, effects: NONE }
  }

  if (event.type === "submitted" || event.type === "blurred") return submitted(state, event)

  if (event.type === "cancelled") {
    if (state.status !== "editing" && state.status !== "saving") return unchanged(state)

    const effects: InlineRenameEffect[] = [{ type: "closed.notify" }, { type: "focus.trigger", ifOwned: false }]

    // Escape stops waiting for a save that hangs.
    return { state: closed(state), effects: state.status === "saving" ? [{ type: "save.cancel" }, ...effects] : effects }
  }

  if (state.status !== "saving" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "save.succeeded")
    return { state: closed(state), effects: [{ type: "closed.notify" }, { type: "focus.trigger", ifOwned: true }] }

  const focus: InlineRenameEffect = { type: "focus.input", select: false, ifOwned: true }

  return {
    state: { status: "editing", issued: state.issued, draft: state.draft },
    effects: event.type === "save.timed-out" ? [{ type: "toast.timeout" }, focus] : [focus],
  }
}

export function selectInlineRenameOpen(state: InlineRenameState) {
  return state.status === "editing" || state.status === "saving"
}

export function selectInlineRenameDraft(state: InlineRenameState) {
  return state.status === "editing" || state.status === "saving" ? state.draft : ""
}

export function selectInlineRenameSaving(state: InlineRenameState) {
  return state.status === "saving"
}

export function selectInlineRenameMenuOpen(state: InlineRenameState) {
  return state.status === "menu"
}

// Enter and a submitting blur save a changed name. An unchanged or blank one, or a discarding blur, just closes.
function submitted(
  state: InlineRenameState,
  event: Extract<InlineRenameEvent, { type: "submitted" | "blurred" }>,
): InlineRenameTransition {
  // Clicking away while a save is in flight lets it finish; the closing field's own blur lands here too.
  if (state.status !== "editing") return unchanged(state)
  const value = state.draft.trim()
  const discard = event.type === "blurred" && event.policy === "cancel"

  if (discard || !value || value === event.currentValue) {
    // A blur already moved focus where the user wanted it.
    const effects: InlineRenameEffect[] =
      event.type === "submitted"
        ? [{ type: "closed.notify" }, { type: "focus.trigger", ifOwned: false }]
        : [{ type: "closed.notify" }]

    return { state: closed(state), effects }
  }

  const attempt = state.issued + 1

  return {
    state: { status: "saving", issued: attempt, attempt, draft: state.draft },
    effects: [{ type: "save.run", attempt, value, timeoutMs: INLINE_RENAME_TIMEOUT_MS }],
  }
}

function closed(state: Exclude<InlineRenameState, { status: "disposed" }>): InlineRenameState {
  return { status: "closed", issued: state.issued }
}

function unchanged(state: InlineRenameState): InlineRenameTransition {
  return { state, effects: NONE }
}
