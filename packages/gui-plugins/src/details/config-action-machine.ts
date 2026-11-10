/** How long reading the configuration and opening, revealing or copying its file may take before it gives up. */
export const CONFIG_ACTION_TIMEOUT_MS = 15_000

/** How long a copied path keeps its mark. */
export const CONFIG_COPIED_MS = 2_000

/**
 * A footer action that reads the server's configuration: the configuration file link or a setup button. Each click
 * takes the next attempt number, so a result whose attempt the state no longer holds is stale; `issued` is the last
 * one handed out.
 */
export type ConfigActionState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "opening"; readonly attempt: number }
  /** A remote server's configuration path is on the clipboard. */
  | { readonly status: "copied"; readonly attempt: number }
  | { readonly status: "disposed" }

export type ConfigActionEvent =
  | { readonly type: "activate" }
  /** The file or draft opened; `close` closes the popover, which a side tab or a draft replaces. */
  | { readonly type: "opened"; readonly attempt: number; readonly close: boolean }
  | { readonly type: "copied"; readonly attempt: number }
  | { readonly type: "failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "timed-out"; readonly attempt: number }
  | { readonly type: "copied.expired"; readonly attempt: number }
  /** The popover or drawer that shows the action hid. */
  | { readonly type: "hidden" }
  | { readonly type: "disposed" }

export type ConfigActionEffect =
  /** Starts the attempt's controller and timeout, then runs the action. */
  | { readonly type: "run"; readonly attempt: number; readonly timeoutMs: number }
  /** Ends the attempt's controller and timeout. */
  | { readonly type: "abort"; readonly attempt: number }
  | { readonly type: "schedule-reset"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-reset" }
  | { readonly type: "close-owner" }
  | { readonly type: "toast-failed"; readonly error: string }
  | { readonly type: "toast-timed-out" }

export type ConfigActionTransition = {
  readonly state: ConfigActionState
  readonly effects: readonly ConfigActionEffect[]
}

export const initialConfigActionState: ConfigActionState = { status: "idle", issued: 0 }

const NONE: readonly ConfigActionEffect[] = []

const CANCEL_RESET: readonly ConfigActionEffect[] = [{ type: "cancel-reset" }]

export function transitionConfigAction(state: ConfigActionState, event: ConfigActionEvent): ConfigActionTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") {
    if (state.status === "opening")
      return { state: { status: "disposed" }, effects: [{ type: "abort", attempt: state.attempt }] }

    return { state: { status: "disposed" }, effects: state.status === "copied" ? CANCEL_RESET : NONE }
  }

  if (event.type === "hidden") {
    if (state.status !== "copied") return { state, effects: NONE }

    return { state: { status: "idle", issued: state.attempt }, effects: CANCEL_RESET }
  }

  if (event.type === "activate") {
    if (state.status === "opening") return { state, effects: NONE }
    const attempt = (state.status === "idle" ? state.issued : state.attempt) + 1

    return {
      state: { status: "opening", attempt },
      effects: [
        ...(state.status === "copied" ? CANCEL_RESET : NONE),
        { type: "run", attempt, timeoutMs: CONFIG_ACTION_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "copied.expired") {
    if (state.status !== "copied" || state.attempt !== event.attempt) return { state, effects: NONE }

    return { state: { status: "idle", issued: state.attempt }, effects: NONE }
  }

  if (state.status !== "opening" || state.attempt !== event.attempt) return { state, effects: NONE }
  const abort: ConfigActionEffect = { type: "abort", attempt: state.attempt }
  const idle: ConfigActionState = { status: "idle", issued: state.attempt }

  if (event.type === "opened") return { state: idle, effects: event.close ? [abort, { type: "close-owner" }] : [abort] }

  if (event.type === "copied")
    return {
      state: { status: "copied", attempt: state.attempt },
      effects: [abort, { type: "schedule-reset", attempt: state.attempt, delayMs: CONFIG_COPIED_MS }],
    }

  if (event.type === "failed") return { state: idle, effects: [abort, { type: "toast-failed", error: event.error }] }

  return { state: idle, effects: [abort, { type: "toast-timed-out" }] }
}

export function configActionView(state: ConfigActionState) {
  return { disabled: state.status === "opening", copied: state.status === "copied" }
}
