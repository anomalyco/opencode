/** How long the width and crossfade transitions keep both titles mounted. */
export const TOOL_STATUS_ANIMATION_MS = 600

/** `suffix` animates only the differing tail after a shared prefix; `swap` animates the whole title. */
export type ToolStatusMode = "suffix" | "swap"

type Shared = {
  readonly active: boolean
  readonly mode: ToolStatusMode
  /** The tail the user sees: the active text while active, the done text after. */
  readonly text: string
}

/**
 * A title that animates between its active and done text. `idle` shows one text at its natural width. `measuring` pins
 * the previous width for one frame with both texts mounted, `animating` transitions to the measured width until the
 * transition ends. `crossfade` keeps the animation even at an unchanged width, so the two texts still fade. `attempts`
 * counts started animations, so a frame or timer of an earlier one is stale.
 */
export type ToolStatusTitleState =
  | (Shared & { readonly status: "idle"; readonly attempts: number })
  | (Shared & {
      readonly status: "measuring"
      readonly attempt: number
      readonly from: string
      readonly crossfade: boolean
    })
  | (Shared & { readonly status: "animating"; readonly attempt: number; readonly width: string })
  | { readonly status: "disposed" }

export type ToolStatusTitleEvent =
  | {
      readonly type: "sync"
      readonly active: boolean
      readonly mode: ToolStatusMode
      readonly text: string
      /** The current width, or `undefined` while the title is hidden, detached or has no width. */
      readonly width: string | undefined
      readonly reducedMotion: boolean
    }
  | {
      readonly type: "measured"
      readonly attempt: number
      /** The new text's width, or `undefined` while the title is hidden, detached or has no width. */
      readonly width: string | undefined
    }
  | { readonly type: "settled"; readonly attempt: number }
  | { readonly type: "disposed" }

export const DISPOSED_TOOL_STATUS_TITLE_STATE: ToolStatusTitleState = Object.freeze({ status: "disposed" })

export const DISPOSED_TOOL_STATUS_TITLE_EVENT: ToolStatusTitleEvent = Object.freeze({ type: "disposed" })

export function createToolStatusTitleState(input: Shared): ToolStatusTitleState {
  return { status: "idle", active: input.active, mode: input.mode, text: input.text, attempts: 0 }
}

export function transitionToolStatusTitle(
  state: ToolStatusTitleState,
  event: ToolStatusTitleEvent,
): ToolStatusTitleState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_TOOL_STATUS_TITLE_STATE
  const attempts = state.status === "idle" ? state.attempts : state.attempt

  if (event.type === "sync") {
    // A change to the hidden text shows nothing new.
    if (event.active === state.active && event.mode === state.mode && event.text === state.text) return state

    // A hidden title has no width to animate from, and a width from the other mode's container would jump the layout.
    if (!event.width || event.reducedMotion || event.mode !== state.mode)
      return { status: "idle", active: event.active, mode: event.mode, text: event.text, attempts }

    return {
      status: "measuring",
      active: event.active,
      mode: event.mode,
      text: event.text,
      attempt: attempts + 1,
      from: event.width,
      crossfade: event.active !== state.active || state.status !== "idle",
    }
  }

  if (event.type === "measured") {
    if (state.status !== "measuring" || event.attempt !== state.attempt) return state

    if (!event.width || (!state.crossfade && event.width === state.from))
      return { status: "idle", active: state.active, mode: state.mode, text: state.text, attempts: state.attempt }

    return {
      status: "animating",
      active: state.active,
      mode: state.mode,
      text: state.text,
      attempt: state.attempt,
      width: event.width,
    }
  }

  if (state.status !== "animating" || event.attempt !== state.attempt) return state

  return { status: "idle", active: state.active, mode: state.mode, text: state.text, attempts: state.attempt }
}

export function viewToolStatusTitle(state: ToolStatusTitleState) {
  if (state.status === "disposed")
    return { active: false, animating: false, width: undefined, showActive: false, showDone: true }

  if (state.status === "idle")
    return { active: state.active, animating: false, width: undefined, showActive: state.active, showDone: !state.active }

  // Both texts stay mounted so one fades out while the other fades in.
  return {
    active: state.active,
    animating: true,
    width: state.status === "measuring" ? state.from : state.width,
    showActive: true,
    showDone: true,
  }
}
