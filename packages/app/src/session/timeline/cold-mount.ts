// A pinned timeline without cached measurements mounts hidden: first only the cheap tail, then the full range, and it
// reveals once a pass finds every row measured, Markdown ready and the view at its end. The fallback timer bounds that
// wait, so a block that never reports ready or a gate that never clears cannot leave the timeline invisible. A link
// that is a few frames from putting its place under the view gets one more wait of the same length: on a machine
// slow enough to need it, the fallback showed the session's end and the view then jumped to the link's prompt.
export const COLD_REVEAL_TIMEOUT = 3_000

type Hidden = {
  /** Increments on each activation, so a timer or check from an earlier one is ignored. 0 until mounted. */
  readonly attempt: number
  readonly active: boolean
  /** A check is scheduled or running for `attempt`; more requests join it. */
  readonly checking: boolean
  /** A batched row-size commit is running; its per-row scroll writes wait for one pin after it. */
  readonly flushing: boolean
  /** The fallback timer ran out once while a link was about to land, and runs once more. */
  readonly extended: boolean
}

export type ColdMountState =
  | ({ readonly type: "measuring-tail" } & Hidden)
  | ({ readonly type: "expanding" } & Hidden)
  | { readonly type: "revealed" }

/**
 * What a check found. `waiting`: a gate before the pin is still closed (detached or zero-height view, pending Markdown,
 * unmeasured rows). `pinned`: the view is at its end, but the pin exposed rows still measuring. `settled`: all clear.
 */
export type ColdMountSample = "waiting" | "pinned" | "settled"

export type ColdMountEvent =
  | { readonly type: "mounted"; readonly active: boolean }
  | { readonly type: "activated" }
  | { readonly type: "deactivated" }
  | { readonly type: "check.requested" }
  | { readonly type: "check.ready"; readonly attempt: number }
  | { readonly type: "check.sampled"; readonly attempt: number; readonly sample: ColdMountSample }
  | { readonly type: "sizes.flushing" }
  | { readonly type: "sizes.flushed" }
  /** The fallback timer ran out. `landing`: a link is a few frames from putting its place under the view. */
  | { readonly type: "timeout"; readonly attempt: number; readonly landing: boolean }
  | { readonly type: "disposed" }

export type ColdMountEffect =
  | { readonly type: "observe" }
  | { readonly type: "timer.start"; readonly attempt: number }
  | { readonly type: "timer.cancel" }
  | { readonly type: "check.schedule"; readonly attempt: number }
  | { readonly type: "check.sample"; readonly attempt: number }
  | { readonly type: "pin" }
  | { readonly type: "release" }

export type ColdMountTransition = {
  readonly state: ColdMountState
  readonly effects: readonly ColdMountEffect[]
}

const revealed: ColdMountState = { type: "revealed" }

const none: readonly ColdMountEffect[] = []

const settled: ColdMountTransition = { state: revealed, effects: none }

// Shared events for the frequent dispatches, so a revealed timeline allocates nothing on scroll or resize.
export const CHECK_REQUESTED: ColdMountEvent = { type: "check.requested" }

export const ACTIVATED: ColdMountEvent = { type: "activated" }

export const DEACTIVATED: ColdMountEvent = { type: "deactivated" }

export const SIZES_FLUSHING: ColdMountEvent = { type: "sizes.flushing" }

export const SIZES_FLUSHED: ColdMountEvent = { type: "sizes.flushed" }

export const DISPOSED: ColdMountEvent = { type: "disposed" }

export function createColdMountState(cold: boolean): ColdMountState {
  if (!cold) return revealed

  return { type: "measuring-tail", attempt: 0, active: false, checking: false, flushing: false, extended: false }
}

export function transitionColdMount(state: ColdMountState, event: ColdMountEvent): ColdMountTransition {
  if (state.type === "revealed") return settled

  if (event.type === "mounted") {
    if (state.attempt > 0) return quiet(state)

    if (!event.active) return { state: { ...state, attempt: 1 }, effects: [{ type: "observe" }] }

    return {
      state: { ...state, attempt: 1, active: true, checking: true },
      effects: [{ type: "observe" }, { type: "timer.start", attempt: 1 }, { type: "check.schedule", attempt: 1 }],
    }
  }

  if (event.type === "activated") {
    if (state.attempt === 0 || state.active) return quiet(state)
    const attempt = state.attempt + 1

    return {
      state: { ...state, attempt, active: true, checking: true, extended: false },
      effects: [
        { type: "timer.start", attempt },
        { type: "check.schedule", attempt },
      ],
    }
  }

  if (event.type === "deactivated") {
    if (!state.active) return quiet(state)

    return { state: { ...state, active: false, checking: false }, effects: [{ type: "timer.cancel" }] }
  }

  if (event.type === "check.requested") {
    if (!state.active || state.checking) return quiet(state)

    return { state: { ...state, checking: true }, effects: [{ type: "check.schedule", attempt: state.attempt }] }
  }

  if (event.type === "check.ready") {
    if (!current(state, event.attempt) || !state.checking) return quiet(state)

    return { state, effects: [{ type: "check.sample", attempt: state.attempt }] }
  }

  if (event.type === "check.sampled") return sampled(state, event)

  if (event.type === "sizes.flushing") return state.flushing ? quiet(state) : quiet({ ...state, flushing: true })

  if (event.type === "sizes.flushed") return state.flushing ? quiet({ ...state, flushing: false }) : quiet(state)

  if (event.type === "timeout") {
    if (!current(state, event.attempt)) return quiet(state)

    if (event.landing && !state.extended)
      return { state: { ...state, extended: true }, effects: [{ type: "timer.start", attempt: state.attempt }] }

    return { state: revealed, effects: [{ type: "release" }, { type: "pin" }] }
  }

  return { state: revealed, effects: [{ type: "release" }] }
}

/** The content stays invisible until the reveal. */
export function coldMountHidden(state: ColdMountState) {
  return state.type !== "revealed"
}

/** Only the cheap suffix at the end mounts, so the first pass measures the fewest rows. */
export function coldMountTailOnly(state: ColdMountState) {
  return state.type === "measuring-tail"
}

/** A pinned view skips per-row scroll writes while a batched size commit runs. */
export function coldMountFlushing(state: ColdMountState) {
  return state.type !== "revealed" && state.flushing
}

function sampled(
  state: Exclude<ColdMountState, { type: "revealed" }>,
  event: Extract<ColdMountEvent, { type: "check.sampled" }>,
): ColdMountTransition {
  if (!current(state, event.attempt) || !state.checking) return quiet(state)

  // Observers and the size commit request the next check once something changes.
  if (event.sample === "waiting") return quiet({ ...state, checking: false })

  if (state.type === "measuring-tail")
    return {
      state: { ...state, type: "expanding" },
      effects: [{ type: "check.schedule", attempt: state.attempt }],
    }

  if (event.sample === "pinned") return quiet({ ...state, checking: false })

  return { state: revealed, effects: [{ type: "release" }] }
}

function current(state: Exclude<ColdMountState, { type: "revealed" }>, attempt: number) {
  return state.active && state.attempt === attempt
}

function quiet(state: ColdMountState): ColdMountTransition {
  return { state, effects: none }
}
