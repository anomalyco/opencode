export const TEXT_FIELD_COPIED_MS = 2_000

/** A clipboard write that never settles gives up, so the button can copy again. */
export const TEXT_FIELD_COPY_TIMEOUT_MS = 2_000

export type TextFieldCopyKind = "clipboard" | "link"

/**
 * The copy button's feedback. `copying` claims the click before the write starts, so a second click waits for it;
 * `keepCopied` keeps the checkmark of an earlier copy while a repeat copy settles. `attempt` lets only the latest
 * write, its timeout and its own reset timer move the button.
 */
export type TextFieldCopyState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "copying"; readonly attempt: number; readonly keepCopied: boolean }
  | { readonly status: "copied"; readonly attempt: number }
  | { readonly status: "disposed" }

export type TextFieldCopyEvent =
  | { readonly type: "copy.requested"; readonly value: string; readonly enabled: boolean }
  | { readonly type: "copy.succeeded"; readonly attempt: number }
  | { readonly type: "copy.failed"; readonly attempt: number }
  | { readonly type: "copy.timed-out"; readonly attempt: number }
  | { readonly type: "reset.elapsed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type TextFieldCopyEffect =
  | { readonly type: "clipboard.write"; readonly attempt: number; readonly value: string; readonly timeoutMs: number }
  | { readonly type: "reset.schedule"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.clear" }

export type TextFieldCopyTransition = {
  readonly state: TextFieldCopyState
  readonly effects: readonly TextFieldCopyEffect[]
}

export const INITIAL_TEXT_FIELD_COPY_STATE: TextFieldCopyState = Object.freeze({ status: "idle", issued: 0 })

const NO_EFFECTS: readonly TextFieldCopyEffect[] = Object.freeze([])

const TIMER_CLEAR: TextFieldCopyEffect = Object.freeze({ type: "timer.clear" })

const DISPOSED: TextFieldCopyState = Object.freeze({ status: "disposed" })

export function transitionTextFieldCopy(state: TextFieldCopyState, event: TextFieldCopyEvent): TextFieldCopyTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return { state: DISPOSED, effects: state.status === "idle" ? NO_EFFECTS : [TIMER_CLEAR] }

  if (event.type === "copy.requested") {
    if (!event.enabled || state.status === "copying") return { state, effects: NO_EFFECTS }
    const attempt = (state.status === "idle" ? state.issued : state.attempt) + 1
    const write: TextFieldCopyEffect = {
      type: "clipboard.write",
      attempt,
      value: event.value,
      timeoutMs: TEXT_FIELD_COPY_TIMEOUT_MS,
    }

    if (state.status === "copied") {
      return { state: { status: "copying", attempt, keepCopied: true }, effects: [TIMER_CLEAR, write] }
    }

    return { state: { status: "copying", attempt, keepCopied: false }, effects: [write] }
  }

  if (state.status === "idle" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  if (state.status === "copying" && event.type === "copy.succeeded") {
    return {
      state: { status: "copied", attempt: state.attempt },
      effects: [TIMER_CLEAR, { type: "reset.schedule", attempt: state.attempt, delayMs: TEXT_FIELD_COPIED_MS }],
    }
  }

  if (state.status === "copying" && (event.type === "copy.failed" || event.type === "copy.timed-out")) {
    return { state: { status: "idle", issued: state.attempt }, effects: [TIMER_CLEAR] }
  }

  if (state.status === "copied" && event.type === "reset.elapsed") {
    return { state: { status: "idle", issued: state.attempt }, effects: NO_EFFECTS }
  }

  return { state, effects: NO_EFFECTS }
}

export function selectTextFieldCopied(state: TextFieldCopyState) {
  return state.status === "copied" || (state.status === "copying" && state.keepCopied)
}

export function selectTextFieldCopyLabelKey(state: TextFieldCopyState, kind: TextFieldCopyKind | undefined) {
  if (selectTextFieldCopied(state)) return "ui.textField.copied"

  if (kind === "link") return "ui.textField.copyLink"

  return "ui.textField.copyToClipboard"
}

export function selectTextFieldCopyIcon(state: TextFieldCopyState, kind: TextFieldCopyKind | undefined) {
  if (selectTextFieldCopied(state)) return "check"

  if (kind === "link") return "link"

  return "copy"
}
