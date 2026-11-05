/**
 * A flight that has not landed by then lands at once, e.g. in a hidden window whose frames stopped. The slowest
 * flight's spring rests in about 0.6s; the driver stretches this by the global speed and slow motion.
 */
export const PANEL_FLIGHT_TIMEOUT_MS = 1_500

export type PanelWaiter = { readonly open: boolean; readonly run: () => void }

/**
 * An edge panel at rest or in flight toward `open`. The spring that carries a flight frame by frame lives in the
 * driver; the machine owns only the phases. `sync` and rest `waiters` are requests made before the open change
 * reached the motion, e.g. inside a batch; they last until the change arrives or the microtask after.
 */
export type PanelMotionState =
  | {
      readonly status: "rest" | "flying"
      readonly open: boolean
      readonly attempt: number
      readonly identity: unknown
      /** A state `sync` asked to show at once. */
      readonly sync: boolean | undefined
      readonly waiters: readonly PanelWaiter[]
    }
  | { readonly status: "disposed" }

export type PanelMotionEvent =
  | { readonly type: "target.changed"; readonly open: boolean; readonly identity: unknown; readonly reduced: boolean }
  /** `current` is the panel's open input when `sync` runs. */
  | { readonly type: "sync.requested"; readonly open: boolean; readonly current: boolean }
  | { readonly type: "waiter.queued"; readonly open: boolean; readonly run: () => void }
  | { readonly type: "pending.expired" }
  | { readonly type: "flight.landed"; readonly attempt: number }
  | { readonly type: "flight.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type PanelMotionEffect =
  /** Moves the spring to `open` at once and paints it. */
  | { readonly type: "snap"; readonly open: boolean }
  /** Retargets the spring toward `open` and runs frames until it lands. */
  | { readonly type: "fly"; readonly attempt: number; readonly open: boolean }
  /** Stops the frames and the fallback timer, and releases the held boxes. */
  | { readonly type: "land" }
  | { readonly type: "reveal" }
  | { readonly type: "closed" }
  | { readonly type: "run"; readonly waiters: readonly (() => void)[] }
  /** Expires `sync` and rest `waiters` on the next microtask. */
  | { readonly type: "expire" }

export type PanelMotionTransition = {
  readonly state: PanelMotionState
  readonly effects: readonly PanelMotionEffect[]
}

// No identity matches it, so the first target the driver reports snaps to its state without motion.
const UNSEEN = Symbol("unseen")

export const createPanelMotionState = (open: boolean): PanelMotionState => ({
  status: "rest",
  open,
  attempt: 0,
  identity: UNSEEN,
  sync: undefined,
  waiters: [],
})

export const DISPOSED_PANEL_MOTION_STATE: PanelMotionState = { status: "disposed" }

const NO_EFFECTS: readonly PanelMotionEffect[] = []

const NO_WAITERS: readonly PanelWaiter[] = []

const LAND: PanelMotionEffect = { type: "land" }

const EXPIRE: readonly PanelMotionEffect[] = [{ type: "expire" }]

export function transitionPanelMotion(state: PanelMotionState, event: PanelMotionEvent): PanelMotionTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  switch (event.type) {
    case "disposed":
      return { state: DISPOSED_PANEL_MOTION_STATE, effects: state.status === "flying" ? [LAND] : NO_EFFECTS }
    case "flight.landed":
    case "flight.timed-out": {
      if (state.status !== "flying" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

      // A landed spring already rests where it lands; a timed-out one jumps there.
      return land(state, state.open, event.type === "flight.timed-out" ? [{ type: "snap", open: state.open }] : [])
    }
    case "pending.expired": {
      if (state.status === "flying")
        return state.sync === undefined ? { state, effects: NO_EFFECTS } : { state: { ...state, sync: undefined }, effects: NO_EFFECTS }

      if (state.sync === undefined && state.waiters.length === 0) return { state, effects: NO_EFFECTS }

      // No change arrived, so work queued for one runs where the panel rests.
      return {
        state: { ...state, sync: undefined, waiters: NO_WAITERS },
        effects: state.waiters.length ? [{ type: "run", waiters: state.waiters.map((waiter) => waiter.run) }] : NO_EFFECTS,
      }
    }
    case "waiter.queued": {
      if (state.status === "rest" && state.open === event.open) return { state, effects: [{ type: "run", waiters: [event.run] }] }

      return {
        state: { ...state, waiters: [...state.waiters, { open: event.open, run: event.run }] },
        effects: state.status === "rest" ? EXPIRE : NO_EFFECTS,
      }
    }
    case "sync.requested": {
      if (state.status === "flying" && event.current === event.open) return land(state, event.open, [{ type: "snap", open: event.open }])

      if (state.sync === event.open) return { state, effects: NO_EFFECTS }

      return { state: { ...state, sync: event.open }, effects: EXPIRE }
    }
    case "target.changed":
      return retarget(state, event)
  }
}

function retarget(
  state: Extract<PanelMotionState, { status: "rest" | "flying" }>,
  event: Extract<PanelMotionEvent, { type: "target.changed" }>,
): PanelMotionTransition {
  const open = event.open

  // Another layout shows its own state at once, without a close or the work queued for this one.
  if (event.identity !== state.identity)
    return {
      state: { ...state, status: "rest", open, identity: event.identity, sync: undefined, waiters: NO_WAITERS },
      effects: state.status === "flying" ? [{ type: "snap", open }, LAND] : [{ type: "snap", open }],
    }

  if (state.status === "rest" && state.open === open) {
    if (state.sync === undefined && state.waiters.length === 0) return { state, effects: NO_EFFECTS }

    return { state: { ...state, sync: undefined, waiters: NO_WAITERS }, effects: NO_EFFECTS }
  }

  const instant = state.sync === open

  if (instant || event.reduced)
    return land(state, open, [{ type: "snap", open }], !instant && open ? [{ type: "reveal" }] : NO_EFFECTS)

  if (state.status === "flying" && state.open === open)
    return state.sync === undefined ? { state, effects: NO_EFFECTS } : { state: { ...state, sync: undefined }, effects: NO_EFFECTS }

  // Retargeting keeps the spring's position and velocity, so a turnaround mid-flight is smooth. Work queued for the
  // other direction no longer applies.
  const attempt = state.attempt + 1

  return {
    state: {
      ...state,
      status: "flying",
      open,
      attempt,
      sync: undefined,
      waiters: state.waiters.filter((waiter) => waiter.open === open),
    },
    effects: [{ type: "fly", attempt, open }],
  }
}

function land(
  state: Extract<PanelMotionState, { status: "rest" | "flying" }>,
  open: boolean,
  before: readonly PanelMotionEffect[],
  after: readonly PanelMotionEffect[] = NO_EFFECTS,
): PanelMotionTransition {
  const waiters = state.waiters.filter((waiter) => waiter.open === open).map((waiter) => waiter.run)

  return {
    state: { ...state, status: "rest", open, sync: undefined, waiters: NO_WAITERS },
    effects: [
      ...before,
      ...(state.status === "flying" ? [LAND] : []),
      ...(open ? [] : [{ type: "closed" } as const]),
      ...(waiters.length ? [{ type: "run", waiters } as const] : []),
      ...after,
    ],
  }
}

/** The panel renders: open, or in flight either way, until a close lands. */
export const selectPanelPresent = (state: PanelMotionState) =>
  state.status === "flying" || (state.status === "rest" && state.open)
