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

/** The state the stage shows. */
export function labStageIndex(state: LabStageState) {
  return state.status === "disposed" ? 0 : state.index
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

/**
 * How a press reached the tree. A folder opens and closes only by a click or Space in the tree, so moving by arrows
 * (which selects as it goes) or a selection from elsewhere leaves it as it is.
 */
export type LabTreeGesture = "none" | "pointer" | "space"

/**
 * While browsing the tree by keys, a story that focuses something as it mounts (a dialog, a field) would take the
 * keys away. A press or Tab anywhere ends browsing; a few returns at most, so a story that traps focus still wins.
 */
export type LabBrowseState =
  | { readonly status: "idle"; readonly gesture: LabTreeGesture }
  | { readonly status: "browsing"; readonly redirects: 1 | 2 | 3; readonly gesture: LabTreeGesture }

export type LabBrowseEvent =
  | { readonly type: "pointer.down"; readonly inTree: boolean }
  | { readonly type: "pointer.ended" }
  | { readonly type: "key.down"; readonly key: string; readonly inTree: boolean }
  | { readonly type: "key.ended" }
  | { readonly type: "window.blurred" }
  | { readonly type: "story.opened"; readonly fromTree: boolean }
  /** Focus moved into the stage. */
  | { readonly type: "stage.focused" }

export type LabBrowseEffect = { readonly type: "focus.tree" }

export type LabBrowseTransition = {
  readonly state: LabBrowseState
  readonly effects: readonly LabBrowseEffect[]
}

export const INITIAL_LAB_BROWSE_STATE: LabBrowseState = Object.freeze({ status: "idle", gesture: "none" })

export function transitionLabBrowse(state: LabBrowseState, event: LabBrowseEvent): LabBrowseTransition {
  if (event.type === "pointer.down") {
    const gesture = event.inTree ? "pointer" : "none"

    return { state: state.status === "idle" && state.gesture === gesture ? state : idle(gesture), effects: [] }
  }

  if (event.type === "key.down") {
    if (event.key === "Tab") return { state: INITIAL_LAB_BROWSE_STATE, effects: [] }

    return { state: withGesture(state, event.key === " " && event.inTree ? "space" : "none"), effects: [] }
  }

  if (event.type === "pointer.ended")
    return { state: state.gesture === "pointer" ? withGesture(state, "none") : state, effects: [] }

  if (event.type === "key.ended")
    return { state: state.gesture === "space" ? withGesture(state, "none") : state, effects: [] }

  if (event.type === "window.blurred") return { state: INITIAL_LAB_BROWSE_STATE, effects: [] }

  if (event.type === "story.opened") {
    if (!event.fromTree) return { state: idle(state.gesture), effects: [] }

    return { state: { status: "browsing", redirects: 3, gesture: state.gesture }, effects: [] }
  }

  if (state.status === "idle") return { state, effects: [] }

  return {
    state:
      state.redirects === 1
        ? idle(state.gesture)
        : { status: "browsing", redirects: state.redirects === 3 ? 2 : 1, gesture: state.gesture },
    effects: [{ type: "focus.tree" }],
  }
}

/** A selection of a folder toggles it only while a click or Space in the tree caused it. */
export function selectShouldToggleFolder(state: LabBrowseState) {
  return state.gesture !== "none"
}

function idle(gesture: LabTreeGesture): LabBrowseState {
  return gesture === "none" ? INITIAL_LAB_BROWSE_STATE : { status: "idle", gesture }
}

function withGesture(state: LabBrowseState, gesture: LabTreeGesture): LabBrowseState {
  if (state.gesture === gesture) return state

  if (state.status === "idle") return idle(gesture)

  return { ...state, gesture }
}
