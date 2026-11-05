export const ABOUT_COPY_WRITE_TIMEOUT_MS = 5_000

export const ABOUT_COPY_OPEN_MS = 2_000

/** Keeps "Copied" as the label while the tooltip plays its close animation after `forceOpen` clears. */
export const ABOUT_COPY_CLOSE_MS = 120

/**
 * The About page's version copy button. `copying` remembers whether "Copied" already shows, so copying again keeps it
 * instead of flashing "Copy". `closing` keeps the label while the tooltip animates out.
 */
export type AboutCopyState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "copying"; readonly issued: number; readonly attempt: number; readonly copied: boolean }
  | { readonly status: "shown"; readonly issued: number; readonly attempt: number }
  | { readonly status: "closing"; readonly issued: number; readonly attempt: number }
  | { readonly status: "disposed" }

export type AboutCopyEvent =
  | { readonly type: "copy.requested"; readonly text: string }
  | { readonly type: "copy.succeeded"; readonly attempt: number }
  | { readonly type: "copy.failed"; readonly attempt: number }
  | { readonly type: "copy.timed-out"; readonly attempt: number }
  | { readonly type: "tooltip.close-due"; readonly attempt: number }
  | { readonly type: "tooltip.reset-due"; readonly attempt: number }
  /** The page is hidden: its portaled tooltip must not stay over the next one. */
  | { readonly type: "hidden" }
  | { readonly type: "disposed" }

export type AboutCopyEffect =
  | { readonly type: "clipboard.write"; readonly attempt: number; readonly text: string }
  /** One timer at a time: scheduling replaces the one pending. */
  | {
      readonly type: "timer.schedule"
      readonly event: "copy.timed-out" | "tooltip.close-due" | "tooltip.reset-due"
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "timer.clear" }
  | { readonly type: "toast.failed" }

export type AboutCopyTransition = {
  readonly state: AboutCopyState
  readonly effects: readonly AboutCopyEffect[]
}

export const INITIAL_ABOUT_COPY_STATE: AboutCopyState = Object.freeze({ status: "idle", issued: 0 })

const DISPOSED: AboutCopyState = Object.freeze({ status: "disposed" })

const NONE: readonly AboutCopyEffect[] = Object.freeze([])

const CLEAR: AboutCopyEffect = Object.freeze({ type: "timer.clear" })

export function transitionAboutCopy(state: AboutCopyState, event: AboutCopyEvent): AboutCopyTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: DISPOSED, effects: [CLEAR] }

  if (event.type === "copy.requested") {
    if (state.status === "copying" || !event.text) return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: { status: "copying", issued: attempt, attempt, copied: state.status !== "idle" },
      effects: [
        { type: "timer.schedule", event: "copy.timed-out", attempt, delayMs: ABOUT_COPY_WRITE_TIMEOUT_MS },
        { type: "clipboard.write", attempt, text: event.text },
      ],
    }
  }

  if (state.status === "idle") return { state, effects: NONE }

  if (event.type === "hidden") return { state: { status: "idle", issued: state.issued }, effects: [CLEAR] }

  if (state.attempt !== event.attempt) return { state, effects: NONE }

  if (state.status === "copying") {
    if (event.type === "copy.succeeded") {
      return {
        state: { status: "shown", issued: state.issued, attempt: state.attempt },
        effects: [
          { type: "timer.schedule", event: "tooltip.close-due", attempt: state.attempt, delayMs: ABOUT_COPY_OPEN_MS },
        ],
      }
    }

    if (event.type === "copy.failed" || event.type === "copy.timed-out")
      return { state: { status: "idle", issued: state.issued }, effects: [CLEAR, { type: "toast.failed" }] }

    return { state, effects: NONE }
  }

  if (state.status === "shown" && event.type === "tooltip.close-due") {
    return {
      state: { status: "closing", issued: state.issued, attempt: state.attempt },
      effects: [
        { type: "timer.schedule", event: "tooltip.reset-due", attempt: state.attempt, delayMs: ABOUT_COPY_CLOSE_MS },
      ],
    }
  }

  if (state.status === "closing" && event.type === "tooltip.reset-due")
    return { state: { status: "idle", issued: state.issued }, effects: NONE }

  return { state, effects: NONE }
}

export function selectAboutCopyView(state: AboutCopyState) {
  const copied =
    state.status === "shown" || state.status === "closing" || (state.status === "copying" && state.copied)

  return {
    disabled: state.status === "copying",
    copied,
    forceOpen: copied && state.status !== "closing" ? true : undefined,
  }
}
