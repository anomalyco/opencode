// The experimental question dock's frame loop. `measuring` is a layout read queued for the next frame; `running` is the
// frame job stepping the dock's springs, with the copies of a question switch under way (`into` arriving, `ghost`
// leaving) and whether a measure waits for the springs to come to rest. Frames return the same state while nothing
// finishes, so a running loop allocates nothing.
export type QuestionLoopState<TInto, TGhost> =
  | { readonly phase: "idle" }
  | { readonly phase: "measuring" }
  | {
      readonly phase: "running"
      readonly measureDeferred: boolean
      readonly into: TInto | undefined
      readonly ghost: TGhost | undefined
    }

export type QuestionLoopEvent<TInto, TGhost> =
  | { readonly type: "measure.requested" }
  | { readonly type: "measure.completed" }
  | { readonly type: "switch.started"; readonly into: TInto; readonly ghost: TGhost }
  | { readonly type: "switch.dropped" }
  | { readonly type: "wake"; readonly moving: boolean }
  | { readonly type: "frame"; readonly intoDone: boolean; readonly ghostDone: boolean; readonly moving: boolean }
  | { readonly type: "still" }
  | { readonly type: "disposed" }

export const IDLE_QUESTION_LOOP = Object.freeze({ phase: "idle" as const })

export const MEASURING_QUESTION_LOOP = Object.freeze({ phase: "measuring" as const })

// The frames in which no copy finishes, reused so a running loop builds no event.
export const FRAME_MOVING_EVENT = Object.freeze({
  type: "frame" as const,
  intoDone: false,
  ghostDone: false,
  moving: true,
})

export const FRAME_RESTING_EVENT = Object.freeze({
  type: "frame" as const,
  intoDone: false,
  ghostDone: false,
  moving: false,
})

const RUNNING = Object.freeze({ phase: "running" as const, measureDeferred: false, into: undefined, ghost: undefined })

const RUNNING_DEFERRED = Object.freeze({
  phase: "running" as const,
  measureDeferred: true,
  into: undefined,
  ghost: undefined,
})

export function transitionQuestionLoop<TInto, TGhost>(
  state: QuestionLoopState<TInto, TGhost>,
  event: QuestionLoopEvent<TInto, TGhost>,
): QuestionLoopState<TInto, TGhost> {
  if (event.type === "disposed") return IDLE_QUESTION_LOOP

  if (event.type === "measure.requested") {
    if (state.phase === "idle") return MEASURING_QUESTION_LOOP

    if (state.phase === "measuring" || state.measureDeferred) return state

    return running(true, state.into, state.ghost)
  }

  if (event.type === "measure.completed") return state.phase === "measuring" ? IDLE_QUESTION_LOOP : state

  // A switch starting over a queued measure takes it along, to run once the switch comes to rest.
  if (event.type === "switch.started")
    return running(
      state.phase === "running" ? state.measureDeferred : state.phase === "measuring",
      event.into,
      event.ghost,
    )

  // A wake with nothing to move starts no frame job, only the measure the job would have run at rest.
  if (event.type === "wake") {
    if (state.phase === "idle") return event.moving ? RUNNING : MEASURING_QUESTION_LOOP

    if (state.phase === "measuring") return event.moving ? RUNNING_DEFERRED : state

    return rest(state, state.into, state.ghost, event.moving)
  }

  if (state.phase !== "running") return state

  if (event.type === "switch.dropped") return rest(state, undefined, undefined, true)

  // Everything landing where it is going keeps a measure that was waiting for the springs to rest.
  if (event.type === "still") return state.measureDeferred ? MEASURING_QUESTION_LOOP : IDLE_QUESTION_LOOP

  return rest(state, event.intoDone ? undefined : state.into, event.ghostDone ? undefined : state.ghost, event.moving)
}

// A loop with nothing left to move measures the layout it came to rest at.
function rest<TInto, TGhost>(
  state: Extract<QuestionLoopState<TInto, TGhost>, { phase: "running" }>,
  into: TInto | undefined,
  ghost: TGhost | undefined,
  moving: boolean,
): QuestionLoopState<TInto, TGhost> {
  if (!moving && !into && !ghost) return MEASURING_QUESTION_LOOP

  if (into === state.into && ghost === state.ghost) return state

  return running(state.measureDeferred, into, ghost)
}

function running<TInto, TGhost>(
  measureDeferred: boolean,
  into: TInto | undefined,
  ghost: TGhost | undefined,
): QuestionLoopState<TInto, TGhost> {
  if (!into && !ghost) return measureDeferred ? RUNNING_DEFERRED : RUNNING

  return { phase: "running", measureDeferred, into, ghost }
}

export function selectSwitchInto<TInto, TGhost>(state: QuestionLoopState<TInto, TGhost>) {
  return state.phase === "running" ? state.into : undefined
}

export function selectSwitchGhost<TInto, TGhost>(state: QuestionLoopState<TInto, TGhost>) {
  return state.phase === "running" ? state.ghost : undefined
}

export function isSwitchSliding<TInto, TGhost>(state: QuestionLoopState<TInto, TGhost>) {
  return state.phase === "running" && !!(state.into || state.ghost)
}
