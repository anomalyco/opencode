type Stage = {
  /** The story's state names, in order. */
  readonly names: readonly string[]
  /** The state shown. */
  readonly index: number
  /** A motion sync is queued for the next microtask; registrations in between join it. */
  readonly motionQueued: boolean
  /** Each Play advance takes a new attempt, so a timer from an earlier Play or advance is ignored. */
  readonly attempt: number
}

export type LabStageState =
  | ({ readonly status: "paused" } & Stage)
  | ({ readonly status: "playing" } & Stage)
  | { readonly status: "disposed" }

export type LabStageEvent =
  | { readonly type: "play" }
  /** The Pause button, a press in the story or a knob edit. */
  | { readonly type: "pause" }
  | { readonly type: "tick"; readonly attempt: number }
  /** Previous and Next. */
  | { readonly type: "step"; readonly delta: -1 | 1 }
  /** A digit key. */
  | { readonly type: "select"; readonly index: number }
  /** The panel's state moved: a chip, Undo or Reset, or the echo of a preset this machine applied. */
  | { readonly type: "panel.state"; readonly name: string; readonly fromPreset: boolean }
  | { readonly type: "motion.changed" }
  | { readonly type: "motion.flushed" }
  | { readonly type: "disposed" }

export type LabStageEffect =
  /** Dispatch `tick` with `attempt` once the hold has passed. */
  | { readonly type: "timer.schedule"; readonly attempt: number }
  | { readonly type: "timer.clear" }
  /**
   * Shows the state's args. `preset` brings the panel to the state now, `later` in a microtask (the panel moved the
   * state itself through Undo or Reset), `none` when the panel already applied it.
   */
  | { readonly type: "state.apply"; readonly index: number; readonly preset: "now" | "later" | "none" }
  /** Dispatch `motion.flushed` in a microtask. */
  | { readonly type: "motion.queue" }
  | { readonly type: "motion.sync" }

export type LabStageTransition = {
  readonly state: LabStageState
  readonly effects: readonly LabStageEffect[]
}

export function createLabStageState(names: readonly string[]): LabStageState {
  return { status: "paused", names, index: 0, motionQueued: false, attempt: 0 }
}

export function transitionLabStage(state: LabStageState, event: LabStageEvent): LabStageTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: state.status === "playing" ? [{ type: "timer.clear" }] : [] }

  if (event.type === "play") {
    if (state.status === "playing" || state.names.length < 2) return unchanged(state)
    const attempt = state.attempt + 1

    return { state: { ...state, status: "playing", attempt }, effects: [{ type: "timer.schedule", attempt }] }
  }

  if (event.type === "pause") {
    if (state.status !== "playing") return unchanged(state)

    return { state: { ...state, status: "paused" }, effects: [{ type: "timer.clear" }] }
  }

  if (event.type === "tick") {
    if (state.status !== "playing" || state.attempt !== event.attempt) return unchanged(state)
    const index = (state.index + 1) % state.names.length
    const attempt = state.attempt + 1

    return {
      state: { ...state, index, attempt },
      effects: [
        { type: "state.apply", index, preset: "now" },
        { type: "timer.schedule", attempt },
      ],
    }
  }

  if (event.type === "step") {
    if (state.names.length < 2) return unchanged(state)

    return show(state, (state.index + event.delta + state.names.length) % state.names.length, "now")
  }

  if (event.type === "select") {
    if (state.names.length < 2 || event.index < 0 || event.index >= state.names.length) return unchanged(state)

    return show(state, event.index, "now")
  }

  if (event.type === "panel.state") {
    const index = state.names.indexOf(event.name)

    // The echo of a preset applied here, or of the inspector's rebuild, names the state already shown.
    if (index < 0 || state.names[state.index] === event.name) return unchanged(state)

    return show(state, index, event.fromPreset ? "none" : "later")
  }

  if (event.type === "motion.changed") {
    if (state.motionQueued) return unchanged(state)

    return { state: { ...state, motionQueued: true }, effects: [{ type: "motion.queue" }] }
  }

  if (!state.motionQueued) return unchanged(state)

  return { state: { ...state, motionQueued: false }, effects: [{ type: "motion.sync" }] }
}

export function labStageView(state: LabStageState) {
  if (state.status === "disposed") return { index: 0, canPlay: false, canPause: false }

  return {
    index: state.index,
    canPlay: state.status === "paused" && state.names.length > 1,
    canPause: state.status === "playing",
  }
}

/** A hand's choice of state stops Play. */
function show(
  state: Exclude<LabStageState, { status: "disposed" }>,
  index: number,
  preset: "now" | "later" | "none",
): LabStageTransition {
  return {
    state: { ...state, status: "paused", index },
    effects: [
      ...(state.status === "playing" ? [{ type: "timer.clear" } as const] : []),
      { type: "state.apply", index, preset },
    ],
  }
}

function unchanged(state: LabStageState): LabStageTransition {
  return { state, effects: [] }
}
