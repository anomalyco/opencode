/** How long the shown view's layout must settle before its first still. */
export const STILL_SETTLE_DELAY_MS = 600

/** The wait before the next still after one that changed, failed or timed out. */
export const STILL_INITIAL_PAUSE_MS = 3_000

/** The longest wait between stills of a page that stopped changing. */
export const STILL_MAX_PAUSE_MS = 60_000

/** How long a still may take before sampling goes on without it. */
export const STILL_CAPTURE_TIMEOUT_MS = 5_000

/** How long a flight that landed open keeps the still under the native view, until the view has painted. */
export const FLIGHT_LANDING_DELAY_MS = 150

/** Where the shown native view sits in the box, in CSS pixels. */
export type EmbedPlacement = {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A decoded still of the page the embed showed, and where it sat in the box. */
export type KeptStill = EmbedPlacement & {
  readonly page: string | undefined
  readonly url: string
  /** The JPEG's length: a capture of the same length at the same placement most likely shows an unchanged page. */
  readonly bytes: number
}

type StillContext = {
  readonly issued: number
  readonly id: string | undefined
  readonly page: string | undefined
  /** Undefined while the native view is off screen. */
  readonly onscreen: EmbedPlacement | undefined
  /** Whether the window has focus, as main reports it: focus inside an embed blurs the document but not the window. */
  readonly focused: boolean
  readonly moving: boolean
  readonly reducedMotion: boolean
  /** The wait before the next still; it doubles while the page stays unchanged. */
  readonly pause: number
  /** The window regained focus while a still was being taken, so the next one is taken at once. */
  readonly urgent: boolean
  readonly kept: KeptStill | undefined
}

/**
 * Samples stills of the shown page, which stand in for the native view while a panel flight hides it: one once its
 * layout settles, then more while it stays on screen and the window has focus, never one per frame. A page that stops
 * changing is captured less and less often.
 */
export type EmbedStillState =
  | ({ readonly status: "idle" } & StillContext)
  | ({ readonly status: "warming"; readonly attempt: number } & StillContext)
  | ({
      readonly status: "capturing"
      readonly attempt: number
      readonly target: EmbedPlacement & { readonly page: string | undefined }
    } & StillContext)
  | { readonly status: "disposed" }

export type EmbedStillEvent =
  /** The box shows another embed or page; the kept still belongs to neither. */
  | { readonly type: "target.changed"; readonly id: string | undefined; readonly page: string | undefined }
  | { readonly type: "placement.changed"; readonly placement: EmbedPlacement; readonly page: string | undefined }
  | { readonly type: "offscreen" }
  | { readonly type: "motion.changed"; readonly moving: boolean }
  | { readonly type: "focus.changed"; readonly focused: boolean }
  | { readonly type: "reduced-motion.changed"; readonly reducedMotion: boolean }
  | { readonly type: "warm.due"; readonly attempt: number }
  /** The capture matched the kept still's length and placement, so it was not decoded. */
  | { readonly type: "capture.unchanged"; readonly attempt: number }
  | { readonly type: "capture.decoded"; readonly attempt: number; readonly url: string; readonly bytes: number }
  | { readonly type: "capture.failed"; readonly attempt: number }
  | { readonly type: "capture.timeout"; readonly attempt: number }
  | { readonly type: "disposed" }

export type EmbedStillEffect =
  | { readonly type: "warm-timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "warm-timer.stop" }
  | { readonly type: "capture"; readonly attempt: number; readonly id: string }
  | { readonly type: "capture-timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "capture-timer.stop" }
  | { readonly type: "url.revoke"; readonly url: string }

export type EmbedStillTransition = {
  readonly state: EmbedStillState
  readonly effects: readonly EmbedStillEffect[]
}

/** Whether a panel flight paints the kept still in place of the native view. */
export type EmbedFlightState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "flying"; readonly issued: number }
  /** The flight landed open; the still stays under the native view until it has painted. */
  | { readonly status: "landing"; readonly issued: number; readonly attempt: number }
  | { readonly status: "disposed" }

export type EmbedFlightEvent =
  | {
      readonly type: "sync"
      readonly moving: boolean
      /** The plugin shows the box. */
      readonly visible: boolean
      /** The native view is on screen. */
      readonly onscreen: boolean
    }
  | { readonly type: "landing.settled"; readonly attempt: number }
  | { readonly type: "disposed" }

export type EmbedFlightEffect =
  | { readonly type: "landing-timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "landing-timer.stop" }

export type EmbedFlightTransition = {
  readonly state: EmbedFlightState
  readonly effects: readonly EmbedFlightEffect[]
}

type ActiveStill = Exclude<EmbedStillState, { readonly status: "disposed" }>

export const DISPOSED_STILL_STATE: EmbedStillState = Object.freeze({ status: "disposed" })

export const INITIAL_FLIGHT_STATE: EmbedFlightState = Object.freeze({ status: "idle", issued: 0 })

export const DISPOSED_FLIGHT_STATE: EmbedFlightState = Object.freeze({ status: "disposed" })

const NO_STILL_EFFECTS: readonly EmbedStillEffect[] = Object.freeze([])

const NO_FLIGHT_EFFECTS: readonly EmbedFlightEffect[] = Object.freeze([])

export function createEmbedStillState(input: {
  id: string | undefined
  page: string | undefined
  focused: boolean
  reducedMotion: boolean
}): EmbedStillState {
  return {
    status: "idle",
    issued: 0,
    id: input.id,
    page: input.page,
    onscreen: undefined,
    focused: input.focused,
    moving: false,
    reducedMotion: input.reducedMotion,
    pause: STILL_INITIAL_PAUSE_MS,
    urgent: false,
    kept: undefined,
  }
}

export function transitionEmbedStill(state: EmbedStillState, event: EmbedStillEvent): EmbedStillTransition {
  // A decoded still that arrives after its attempt ended still owns its URL.
  if (event.type === "capture.decoded" && (state.status !== "capturing" || state.attempt !== event.attempt))
    return { state, effects: [{ type: "url.revoke", url: event.url }] }

  if (state.status === "disposed") return unchangedStill(state)

  if (event.type === "disposed") return { state: DISPOSED_STILL_STATE, effects: released(state) }

  if (event.type === "target.changed") {
    if (event.id === state.id && event.page === state.page) return unchangedStill(state)

    return schedule(retarget(state, event.id, event.page), STILL_SETTLE_DELAY_MS, released(state))
  }

  if (event.type === "placement.changed") return placed(state, event.placement, event.page)

  if (event.type === "offscreen") {
    if (!state.onscreen) return unchangedStill(state)

    if (state.status === "warming")
      return { state: idle({ ...context(state), onscreen: undefined }), effects: [{ type: "warm-timer.stop" }] }

    // A capture in flight is the still a closing flight shows; it goes on.
    return { state: { ...state, onscreen: undefined }, effects: NO_STILL_EFFECTS }
  }

  if (event.type === "motion.changed") return motion(state, event.moving)

  if (event.type === "focus.changed") {
    if (event.focused === state.focused) return unchangedStill(state)

    if (state.status === "capturing")
      return { state: { ...state, focused: event.focused, urgent: event.focused }, effects: NO_STILL_EFFECTS }

    // Stills pause while the window is in the background; the page may have moved on since the last one.
    return schedule({ ...context(state), focused: event.focused, urgent: false }, 0, NO_STILL_EFFECTS, state)
  }

  if (event.type === "reduced-motion.changed") {
    if (event.reducedMotion === state.reducedMotion) return unchangedStill(state)

    if (state.status === "capturing")
      return { state: { ...state, reducedMotion: event.reducedMotion, urgent: false }, effects: NO_STILL_EFFECTS }

    // Reduced motion lands panels at once, so no flight needs a still.
    return schedule(
      { ...context(state), reducedMotion: event.reducedMotion, urgent: false },
      STILL_SETTLE_DELAY_MS,
      NO_STILL_EFFECTS,
      state,
    )
  }

  if (event.type === "warm.due") {
    if (state.status !== "warming" || state.attempt !== event.attempt) return unchangedStill(state)

    return canWarm(state)
      ? capture(context(state), NO_STILL_EFFECTS)
      : { state: idle(context(state)), effects: NO_STILL_EFFECTS }
  }

  if (state.status !== "capturing" || state.attempt !== event.attempt) return unchangedStill(state)

  if (event.type === "capture.unchanged") {
    const pause = Math.min(state.pause * 2, STILL_MAX_PAUSE_MS)

    return settle(state, { ...context(state), pause }, [{ type: "capture-timer.stop" }])
  }

  if (event.type === "capture.decoded")
    return settle(
      state,
      {
        ...context(state),
        pause: STILL_INITIAL_PAUSE_MS,
        kept: { ...state.target, url: event.url, bytes: event.bytes },
      },
      state.kept
        ? [{ type: "capture-timer.stop" }, { type: "url.revoke", url: state.kept.url }]
        : [{ type: "capture-timer.stop" }],
    )

  return settle(
    state,
    { ...context(state), pause: STILL_INITIAL_PAUSE_MS },
    event.type === "capture.failed" ? [{ type: "capture-timer.stop" }] : NO_STILL_EFFECTS,
  )
}

export function transitionEmbedFlight(state: EmbedFlightState, event: EmbedFlightEvent): EmbedFlightTransition {
  if (state.status === "disposed") return unchangedFlight(state)

  if (event.type === "disposed")
    return {
      state: DISPOSED_FLIGHT_STATE,
      effects: state.status === "landing" ? [{ type: "landing-timer.stop" }] : NO_FLIGHT_EFFECTS,
    }

  if (event.type === "landing.settled") {
    if (state.status !== "landing" || state.attempt !== event.attempt) return unchangedFlight(state)

    return { state: { status: "idle", issued: state.issued }, effects: NO_FLIGHT_EFFECTS }
  }

  // A flight that starts with the view on screen, like a close, or that opens the pane, paints the still in its place.
  if (state.status === "idle")
    return event.moving && (event.onscreen || event.visible)
      ? { state: { status: "flying", issued: state.issued }, effects: NO_FLIGHT_EFFECTS }
      : unchangedFlight(state)

  if (state.status === "flying") {
    if (event.moving) return unchangedFlight(state)

    // A panel that landed closed is gone; one that landed open keeps the still under its view until the view paints.
    if (!event.visible) return { state: { status: "idle", issued: state.issued }, effects: NO_FLIGHT_EFFECTS }
    const attempt = state.issued + 1

    return {
      state: { status: "landing", issued: attempt, attempt },
      effects: [{ type: "landing-timer.start", attempt, delayMs: FLIGHT_LANDING_DELAY_MS }],
    }
  }

  if (event.moving)
    return { state: { status: "flying", issued: state.issued }, effects: [{ type: "landing-timer.stop" }] }

  if (!event.visible)
    return { state: { status: "idle", issued: state.issued }, effects: [{ type: "landing-timer.stop" }] }

  return unchangedFlight(state)
}

/** The kept still a flight paints in place of the native view of `id` on `page`, or undefined. */
export function selectFlightStill(
  flight: EmbedFlightState,
  still: EmbedStillState,
  id: string | undefined,
  page: string | undefined,
) {
  if (flight.status !== "flying" && flight.status !== "landing") return undefined

  if (still.status === "disposed" || !still.kept || id === undefined) return undefined

  return still.kept.id === id && still.kept.page === page ? still.kept : undefined
}

/** Whether the native view is on screen. */
export function selectStillOnscreen(state: EmbedStillState) {
  return state.status !== "disposed" && state.onscreen !== undefined
}

/**
 * Whether a capture of `bytes` for `attempt` most likely shows the kept still again: the same length at the same
 * placement. The driver then skips decoding it.
 */
export function selectStillUnchanged(state: EmbedStillState, attempt: number, bytes: number) {
  if (state.status !== "capturing" || state.attempt !== attempt || bytes === 0 || !state.kept) return false

  const kept = state.kept
  const target = state.target

  return (
    kept.bytes === bytes &&
    kept.id === target.id &&
    kept.page === target.page &&
    kept.x === target.x &&
    kept.y === target.y &&
    kept.width === target.width &&
    kept.height === target.height
  )
}

// Reduced motion lands panels at once, so no flight needs a still; nor does a window in the background or a moving view.
function canWarm(context: StillContext) {
  return (
    context.onscreen !== undefined &&
    context.onscreen.id === context.id &&
    context.focused &&
    !context.moving &&
    !context.reducedMotion
  )
}

function placed(state: ActiveStill, placement: EmbedPlacement, page: string | undefined): EmbedStillTransition {
  if (placement.id !== state.id || page !== state.page)
    return schedule(
      { ...retarget(state, placement.id, page), onscreen: placement },
      STILL_SETTLE_DELAY_MS,
      released(state),
    )

  if (state.status === "capturing") return { state: { ...state, onscreen: placement }, effects: NO_STILL_EFFECTS }

  return schedule({ ...context(state), onscreen: placement }, STILL_SETTLE_DELAY_MS, NO_STILL_EFFECTS, state)
}

function motion(state: ActiveStill, moving: boolean): EmbedStillTransition {
  if (moving === state.moving) return unchangedStill(state)

  if (state.status === "capturing") return { state: { ...state, moving }, effects: NO_STILL_EFFECTS }

  // A flight that starts with the view on screen, like a close, first asks for a fresh still, before the view hides.
  if (moving && state.onscreen)
    return capture(
      { ...context(state), moving, urgent: false },
      state.status === "warming" ? [{ type: "warm-timer.stop" }] : NO_STILL_EFFECTS,
    )

  return schedule({ ...context(state), moving }, STILL_SETTLE_DELAY_MS, NO_STILL_EFFECTS, state)
}

// After a capture settles: the next one waits the pause, or runs at once when the window refocused meanwhile.
function settle(
  state: Extract<EmbedStillState, { readonly status: "capturing" }>,
  next: StillContext,
  effects: readonly EmbedStillEffect[],
) {
  return schedule({ ...next, urgent: false }, state.urgent ? 0 : next.pause, effects)
}

// Arms the next still when one may be taken, else rests. From `previous`, a phase that already waits keeps waiting
// unless the change stops it, and a stopped wait clears its timer.
function schedule(
  next: StillContext,
  delayMs: number,
  effects: readonly EmbedStillEffect[],
  previous?: Exclude<ActiveStill, { readonly status: "capturing" }>,
): EmbedStillTransition {
  if (!canWarm(next))
    return {
      state: idle(next),
      effects: previous?.status === "warming" ? [...effects, { type: "warm-timer.stop" }] : effects,
    }

  const attempt = next.issued + 1

  return {
    state: { status: "warming", ...next, issued: attempt, attempt },
    effects: [...effects, { type: "warm-timer.start", attempt, delayMs }],
  }
}

function capture(next: StillContext, effects: readonly EmbedStillEffect[]): EmbedStillTransition {
  const onscreen = next.onscreen

  if (!onscreen) return { state: idle(next), effects }
  const attempt = next.issued + 1

  return {
    state: { status: "capturing", ...next, issued: attempt, attempt, target: { ...onscreen, page: next.page } },
    effects: [
      ...effects,
      { type: "capture", attempt, id: onscreen.id },
      { type: "capture-timer.start", attempt, delayMs: STILL_CAPTURE_TIMEOUT_MS },
    ],
  }
}

// A new embed or page: its first still comes fresh, and an in-flight capture of the previous one no longer counts.
function retarget(state: ActiveStill, id: string | undefined, page: string | undefined): StillContext {
  return {
    ...context(state),
    id,
    page,
    onscreen: state.onscreen?.id === id ? state.onscreen : undefined,
    pause: STILL_INITIAL_PAUSE_MS,
    urgent: false,
    kept: undefined,
  }
}

// Stops the active phase's timer and gives up the kept still.
function released(state: ActiveStill): readonly EmbedStillEffect[] {
  const timer = stopTimer(state)

  return state.kept ? [...timer, { type: "url.revoke", url: state.kept.url }] : timer
}

function stopTimer(state: ActiveStill): readonly EmbedStillEffect[] {
  if (state.status === "warming") return [{ type: "warm-timer.stop" }]

  if (state.status === "capturing") return [{ type: "capture-timer.stop" }]

  return NO_STILL_EFFECTS
}

function context(state: ActiveStill): StillContext {
  return {
    issued: state.issued,
    id: state.id,
    page: state.page,
    onscreen: state.onscreen,
    focused: state.focused,
    moving: state.moving,
    reducedMotion: state.reducedMotion,
    pause: state.pause,
    urgent: state.urgent,
    kept: state.kept,
  }
}

function idle(context: StillContext): EmbedStillState {
  return { status: "idle", ...context }
}

function unchangedStill(state: EmbedStillState): EmbedStillTransition {
  return { state, effects: NO_STILL_EFFECTS }
}

function unchangedFlight(state: EmbedFlightState): EmbedFlightTransition {
  return { state, effects: NO_FLIGHT_EFFECTS }
}
