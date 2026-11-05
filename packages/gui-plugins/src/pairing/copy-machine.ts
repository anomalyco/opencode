/** How long "Copied" shows after a copy. */
export const COPY_FEEDBACK_MS = 2_000

/** How long one clipboard write may take before it counts as failed. */
export const COPY_TIMEOUT_MS = 5_000

/**
 * The copy link button. Every phase but `idle` names the link it copied, so a code that replaces the link never
 * shows "Copied" or the copy error for it. `attempt` is the last copy handed out.
 */
export type CopyState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "copying"; readonly attempt: number; readonly url: string }
  | { readonly status: "copied"; readonly attempt: number; readonly url: string }
  | { readonly status: "failed"; readonly attempt: number; readonly url: string }
  | { readonly status: "disposed" }

export type CopyEvent =
  | { readonly type: "copy.requested"; readonly url: string }
  | { readonly type: "copy.succeeded"; readonly attempt: number }
  /** The write failed or timed out. */
  | { readonly type: "copy.failed"; readonly attempt: number }
  | { readonly type: "feedback.ended"; readonly attempt: number }
  /** The user asked for a new code. */
  | { readonly type: "reset" }
  | { readonly type: "disposed" }

export type CopyEffect =
  /** Writes the link and arms its timeout in the button's one timer. */
  | { readonly type: "write"; readonly attempt: number; readonly url: string; readonly timeoutMs: number }
  /** Arms the end of "Copied" in the button's one timer. */
  | { readonly type: "schedule-feedback"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-timer" }

export type CopyTransition = { readonly state: CopyState; readonly effects: readonly CopyEffect[] }

const NONE: readonly CopyEffect[] = []

export function createCopyState(): CopyState {
  return { status: "idle", attempt: 0 }
}

export function transitionCopy(state: CopyState, event: CopyEvent): CopyTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [{ type: "cancel-timer" }] }

  if (event.type === "copy.requested") {
    if (state.status === "copying" && state.url === event.url) return { state, effects: NONE }

    const attempt = state.attempt + 1

    return {
      state: { status: "copying", attempt, url: event.url },
      effects: [{ type: "cancel-timer" }, { type: "write", attempt, url: event.url, timeoutMs: COPY_TIMEOUT_MS }],
    }
  }

  if (event.type === "copy.succeeded" || event.type === "copy.failed") {
    if (state.status !== "copying" || state.attempt !== event.attempt) return { state, effects: NONE }

    if (event.type === "copy.failed")
      return {
        state: { status: "failed", attempt: state.attempt, url: state.url },
        effects: [{ type: "cancel-timer" }],
      }

    return {
      state: { status: "copied", attempt: state.attempt, url: state.url },
      effects: [
        { type: "cancel-timer" },
        { type: "schedule-feedback", attempt: state.attempt, delayMs: COPY_FEEDBACK_MS },
      ],
    }
  }

  if (event.type === "feedback.ended") {
    if (state.status !== "copied" || state.attempt !== event.attempt) return { state, effects: NONE }

    return { state: { status: "idle", attempt: state.attempt }, effects: NONE }
  }

  if (state.status === "idle") return { state, effects: NONE }

  return { state: { status: "idle", attempt: state.attempt }, effects: [{ type: "cancel-timer" }] }
}

/** The event that reports an effect that threw, so a copy still ends. */
export function copyEffectFailed(effect: CopyEffect): CopyEvent | undefined {
  return effect.type === "write" ? { type: "copy.failed", attempt: effect.attempt } : undefined
}

/** What the copy button shows for the link on screen now. */
export function viewCopy(state: CopyState, url: string | undefined): CopyView {
  const phase = state.status !== "idle" && state.status !== "disposed" && state.url === url ? state.status : "idle"

  if (phase === "copied") return { icon: "check", label: "common.copied", disabled: false, error: false }

  return { icon: "copy", label: "copyLink", disabled: phase === "copying", error: phase === "failed" }
}

export type CopyView = {
  readonly icon: "check" | "copy"
  readonly label: "common.copied" | "copyLink"
  readonly disabled: boolean
  readonly error: boolean
}
