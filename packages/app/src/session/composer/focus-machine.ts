// How long a mounted session composer may wait to become focusable (draft loaded, no request dock or dialog)
// before it stops trying to take focus.
export const FOCUS_HANDOFF_TIMEOUT_MS = 10_000

// Frames that found the composer gone or hidden after it looked ready, before the attempt gives up.
export const REAL_FOCUS_RETRY_LIMIT = 3

export type PreparingFocus = "claiming" | "focused" | "blurred"

// Focus for the routed session, across the pending session's composer and the session composer that replaces it.
// `target` is the routed session ID; the machine lives under one server, so the ID alone names the session.
// `attempt` advances on every phase change, so a late frame or timer from an earlier phase is ignored.
//
// - `idle`: nothing to do until a session composer mounts, which then takes focus (opening a session).
// - `preparing`: the pending session's composer is shown. `claiming` is its first focus frame in flight.
// - `handoff`: the pending composer unmounted while it held focus; the session composer takes focus and `cursor` when it mounts.
// - `declined`: the user had left the pending composer; the session composer that replaces it leaves focus alone.
// - `pending-real`: the session composer is mounted and waits until it can take focus.
// - `focusing-real`: its focus frame is in flight.
export type ComposerFocusState =
  | { readonly status: "idle"; readonly target: string | undefined; readonly attempt: number }
  | { readonly status: "preparing"; readonly target: string; readonly attempt: number; readonly focus: PreparingFocus }
  | { readonly status: "handoff"; readonly target: string; readonly attempt: number; readonly cursor: number }
  | { readonly status: "declined"; readonly target: string; readonly attempt: number }
  | {
      readonly status: "pending-real"
      readonly target: string
      readonly attempt: number
      readonly cursor: number | undefined
      readonly retries: number
    }
  | {
      readonly status: "focusing-real"
      readonly target: string
      readonly attempt: number
      readonly cursor: number
      readonly retries: number
    }
  | { readonly status: "disposed" }

export type ComposerFocusEvent =
  | { readonly type: "target.changed"; readonly target: string }
  | { readonly type: "preparing.mounted"; readonly target: string; readonly cursor: number }
  | { readonly type: "preparing.frame"; readonly attempt: number; readonly outcome: "focused" | "blocked" }
  | { readonly type: "preparing.focused"; readonly target: string }
  | { readonly type: "preparing.blurred"; readonly target: string }
  | { readonly type: "preparing.unmounted"; readonly target: string; readonly cursor: number }
  | { readonly type: "real.mounted"; readonly target: string }
  | { readonly type: "real.ready"; readonly target: string; readonly cursor: number }
  | { readonly type: "real.frame"; readonly attempt: number; readonly outcome: "focused" | "claimed" | "blocked" }
  | { readonly type: "timeout"; readonly attempt: number }
  | { readonly type: "disposed" }

export type ComposerFocusEffect =
  | { readonly type: "frame.preparing"; readonly target: string; readonly attempt: number; readonly cursor: number }
  | { readonly type: "frame.real"; readonly target: string; readonly attempt: number; readonly cursor: number }
  | { readonly type: "frame.cancel" }
  | { readonly type: "timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.clear" }

export type ComposerFocusTransition = {
  readonly state: ComposerFocusState
  readonly effects: readonly ComposerFocusEffect[]
}

type Active = Exclude<ComposerFocusState, { readonly status: "disposed" }>

const NO_EFFECTS: readonly ComposerFocusEffect[] = []

export function createComposerFocusState(): ComposerFocusState {
  return { status: "idle", target: undefined, attempt: 0 }
}

export function transitionComposerFocus(state: ComposerFocusState, event: ComposerFocusEvent): ComposerFocusTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: cleanup(state) }

  if (event.type === "target.changed") {
    if (event.target === state.target) return unchanged(state)

    return { state: { status: "idle", target: event.target, attempt: state.attempt + 1 }, effects: cleanup(state) }
  }

  if (event.type === "preparing.frame") return preparingFrame(state, event)

  if (event.type === "real.frame") return realFrame(state, event)

  if (event.type === "timeout") {
    if (state.status !== "pending-real" || state.attempt !== event.attempt) return unchanged(state)

    return changed({ status: "idle", target: state.target, attempt: state.attempt })
  }

  if (event.target !== state.target) return unchanged(state)
  const target = event.target
  const attempt = state.attempt + 1

  if (event.type === "preparing.mounted") {
    return changed({ status: "preparing", target, attempt, focus: "claiming" }, [
      ...cleanup(state),
      { type: "frame.preparing", target, attempt, cursor: event.cursor },
    ])
  }

  if (event.type === "real.mounted") return realMounted(state, target)

  if (event.type === "real.ready") {
    if (state.status !== "pending-real") return unchanged(state)
    const cursor = state.cursor ?? event.cursor

    return changed({ status: "focusing-real", target, attempt, cursor, retries: state.retries }, [
      { type: "timer.clear" },
      { type: "frame.real", target, attempt, cursor },
    ])
  }

  if (state.status !== "preparing") return unchanged(state)

  if (event.type === "preparing.unmounted") {
    // A user who left the composer while the session was created keeps focus where they put it.
    if (state.focus === "blurred") return changed({ status: "declined", target, attempt }, cleanup(state))

    // Claiming counts as focused: a session created before the first frame still hands focus over.
    return changed({ status: "handoff", target, attempt, cursor: event.cursor }, cleanup(state))
  }

  const focus = event.type === "preparing.focused" ? "focused" : "blurred"

  if (state.focus === focus) return unchanged(state)

  return changed({ ...state, focus }, cleanup(state))
}

/** Whether the session composer for `target` is waiting to take focus. */
export function needsRealComposerFocus(state: ComposerFocusState, target: string) {
  return state.status === "pending-real" && state.target === target
}

function preparingFrame(
  state: Active,
  event: Extract<ComposerFocusEvent, { readonly type: "preparing.frame" }>,
): ComposerFocusTransition {
  if (state.status !== "preparing" || state.focus !== "claiming" || state.attempt !== event.attempt) {
    return unchanged(state)
  }

  // Another control or a dialog held focus, so the user is elsewhere.
  return changed({ ...state, focus: event.outcome === "focused" ? "focused" : "blurred" })
}

function realFrame(
  state: Active,
  event: Extract<ComposerFocusEvent, { readonly type: "real.frame" }>,
): ComposerFocusTransition {
  if (state.status !== "focusing-real" || state.attempt !== event.attempt) return unchanged(state)

  // The composer became ready, then disappeared or a dialog opened before the frame: wait for it again.
  if (event.outcome === "blocked" && state.retries < REAL_FOCUS_RETRY_LIMIT) {
    const attempt = state.attempt + 1

    return changed(
      {
        status: "pending-real",
        target: state.target,
        attempt,
        cursor: state.cursor,
        retries: state.retries + 1,
      },
      [{ type: "timer.start", attempt, delayMs: FOCUS_HANDOFF_TIMEOUT_MS }],
    )
  }

  return changed({ status: "idle", target: state.target, attempt: state.attempt })
}

function realMounted(state: Active, target: string): ComposerFocusTransition {
  const attempt = state.attempt + 1

  if (state.status === "declined") return changed({ status: "idle", target, attempt })

  if (state.status !== "idle" && state.status !== "handoff") return unchanged(state)

  return changed(
    {
      status: "pending-real",
      target,
      attempt,
      cursor: state.status === "handoff" ? state.cursor : undefined,
      retries: 0,
    },
    [{ type: "timer.start", attempt, delayMs: FOCUS_HANDOFF_TIMEOUT_MS }],
  )
}

function cleanup(state: Active): readonly ComposerFocusEffect[] {
  if ((state.status === "preparing" && state.focus === "claiming") || state.status === "focusing-real") {
    return [{ type: "frame.cancel" }]
  }

  if (state.status === "pending-real") return [{ type: "timer.clear" }]

  return NO_EFFECTS
}

function changed(state: ComposerFocusState, effects = NO_EFFECTS): ComposerFocusTransition {
  return { state, effects }
}

function unchanged(state: ComposerFocusState): ComposerFocusTransition {
  return { state, effects: NO_EFFECTS }
}
