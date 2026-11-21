export const TEXT_RENDER_PACE_MS = 24

/** A live backlog up to this many characters shows at once; a larger one reveals in paced slices. */
export const TEXT_RENDER_IMMEDIATE = 512

const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/

/**
 * Streamed text reveal. `synced` shows the latest text. `pacing` shows a prefix of `target` that is more than
 * `TEXT_RENDER_IMMEDIATE` characters behind it and waits one `TEXT_RENDER_PACE_MS` step, numbered `attempt`.
 * This runs on every streamed delta, so an event that changes nothing returns the same state.
 */
export type PacedTextState =
  | { readonly status: "synced"; readonly shown: string; readonly attempts: number }
  | { readonly status: "pacing"; readonly shown: string; readonly target: string; readonly attempt: number }
  | { readonly status: "disposed" }

export type PacedTextEvent =
  | { readonly type: "sync"; readonly text: string; readonly live: boolean }
  | { readonly type: "tick"; readonly attempt: number }
  | { readonly type: "disposed" }

export const DISPOSED_PACED_TEXT_STATE: PacedTextState = Object.freeze({ status: "disposed" })

export const DISPOSED_PACED_TEXT_EVENT: PacedTextEvent = Object.freeze({ type: "disposed" })

export function createPacedTextState(text: string): PacedTextState {
  return { status: "synced", shown: text, attempts: 0 }
}

export function transitionPacedText(state: PacedTextState, event: PacedTextEvent): PacedTextState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_PACED_TEXT_STATE

  if (event.type === "tick") {
    if (state.status !== "pacing" || event.attempt !== state.attempt) return state

    if (state.target.length - state.shown.length <= TEXT_RENDER_IMMEDIATE)
      return { status: "synced", shown: state.target, attempts: state.attempt }
    const end = nextSliceEnd(state.target, state.shown.length)

    if (end >= state.target.length) return { status: "synced", shown: state.target, attempts: state.attempt }

    return { status: "pacing", shown: state.target.slice(0, end), target: state.target, attempt: state.attempt + 1 }
  }

  const text = event.text

  if (state.status === "synced" && text === state.shown) return state

  if (state.status === "pacing" && event.live && text === state.target) return state

  // The length check runs first, so an ordinary delta never scans the whole response for its prefix.
  if (!event.live || text.length - state.shown.length <= TEXT_RENDER_IMMEDIATE || !text.startsWith(state.shown))
    return { status: "synced", shown: text, attempts: state.status === "pacing" ? state.attempt : state.attempts }

  // A delta during a step keeps its attempt, so a steady stream cannot postpone the next slice.
  if (state.status === "pacing") return { status: "pacing", shown: state.shown, target: text, attempt: state.attempt }

  return { status: "pacing", shown: state.shown, target: text, attempt: state.attempts + 1 }
}

function nextSliceEnd(text: string, start: number) {
  const end = Math.min(text.length, start + Math.min(256, Math.ceil((text.length - start) / 4)))
  const max = Math.min(text.length, end + 8)

  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i]!)) return i + 1
  }

  return end
}
