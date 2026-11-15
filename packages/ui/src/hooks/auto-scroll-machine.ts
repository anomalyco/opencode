export const SETTLE_MS = 300

export const END_EPSILON = 0.5

export type OverflowAnchorMode = "none" | "auto" | "dynamic"

/**
 * `idle`, `following` and `settling` stay pinned to the bottom; `settling` is the tail after work ends, while a text
 * selection still pauses. `detached` is set while `<Suspense>` holds the viewport outside the document. `flight` is the
 * `scrollTop` our own write produced; the next `scroll` event consumes it.
 */
export type AutoScrollState =
  | {
      readonly status: "idle" | "following"
      readonly detached: boolean
      readonly flight: number | undefined
    }
  | {
      readonly status: "settling"
      readonly attempt: number
      readonly detached: boolean
      readonly flight: number | undefined
    }
  | { readonly status: "paused"; readonly working: boolean; readonly detached: boolean }
  | { readonly status: "disposed" }

export type AutoScrollEvent =
  | { readonly type: "working.changed"; readonly working: boolean; readonly attempt: number }
  | { readonly type: "settle.elapsed"; readonly attempt: number }
  | { readonly type: "scroller.changed"; readonly overflow: boolean }
  | { readonly type: "scroller.detached" }
  | { readonly type: "scroller.reattached"; readonly overflow: boolean }
  | { readonly type: "resize"; readonly overflow: boolean }
  | {
      readonly type: "scroll"
      readonly overflow: boolean
      readonly scrollTop: number
      readonly maxScroll: number
      readonly threshold: number
    }
  | { readonly type: "pause"; readonly overflow: boolean }
  | { readonly type: "scroll.bottom"; readonly force: boolean }
  | { readonly type: "flight.started"; readonly top: number }
  | { readonly type: "disposed" }

export type AutoScrollEffect =
  | { readonly type: "pin.bottom" }
  | { readonly type: "notify.interacted" }
  | { readonly type: "settle.start"; readonly attempt: number }
  | { readonly type: "settle.stop" }

export type AutoScrollTransition = {
  readonly state: AutoScrollState
  readonly effects: readonly AutoScrollEffect[]
}

type Unpaused = Extract<AutoScrollState, { readonly detached: boolean; readonly flight: number | undefined }>

type Paused = Extract<AutoScrollState, { readonly status: "paused" }>

export const IDLE: AutoScrollState = Object.freeze({ status: "idle", detached: false, flight: undefined })

export const FOLLOWING: AutoScrollState = Object.freeze({ status: "following", detached: false, flight: undefined })

export const PAUSED_IDLE: AutoScrollState = Object.freeze({ status: "paused", working: false, detached: false })

export const PAUSED_WORKING: AutoScrollState = Object.freeze({ status: "paused", working: true, detached: false })

export const DISPOSED: AutoScrollState = Object.freeze({ status: "disposed" })

const NONE: readonly AutoScrollEffect[] = Object.freeze([])

const PIN: readonly AutoScrollEffect[] = Object.freeze([Object.freeze({ type: "pin.bottom" })])

const NOTIFY = Object.freeze({ type: "notify.interacted" })

const SETTLE_STOP = Object.freeze({ type: "settle.stop" })

const PAUSE: readonly AutoScrollEffect[] = Object.freeze([NOTIFY])

const STOP: readonly AutoScrollEffect[] = Object.freeze([SETTLE_STOP])

const STOP_AND_PIN: readonly AutoScrollEffect[] = Object.freeze([SETTLE_STOP, ...PIN])

const STOP_AND_PAUSE: readonly AutoScrollEffect[] = Object.freeze([SETTLE_STOP, NOTIFY])

// Scroll and resize fire every frame; the common results are prebuilt so they allocate nothing.
const SINGLETONS = [IDLE, FOLLOWING, PAUSED_IDLE, PAUSED_WORKING, DISPOSED]

const KEEP = new Map<AutoScrollState, AutoScrollTransition>(
  SINGLETONS.map((state) => [state, Object.freeze({ state, effects: NONE })]),
)

const PINNED = new Map<AutoScrollState, AutoScrollTransition>(
  SINGLETONS.map((state) => [state, Object.freeze({ state, effects: PIN })]),
)

export function createAutoScrollState(working: boolean) {
  return working ? FOLLOWING : IDLE
}

export function transitionAutoScroll(state: AutoScrollState, event: AutoScrollEvent): AutoScrollTransition {
  if (state.status === "disposed") return to(state, NONE)

  if (event.type === "disposed") return to(DISPOSED, state.status === "settling" ? STOP : NONE)

  if (state.status === "paused") return transitionPaused(state, event)

  return transitionUnpaused(state, event)
}

export function selectUserScrolled(state: AutoScrollState) {
  return state.status === "paused"
}

export function selectOverflowAnchor(state: AutoScrollState, mode: OverflowAnchorMode = "dynamic") {
  if (mode !== "dynamic") return mode

  return state.status === "paused" ? "auto" : "none"
}

/** Selecting text pauses only while content still moves under the selection. */
export function selectPausesOnSelection(state: AutoScrollState) {
  return state.status === "following" || state.status === "settling"
}

function transitionPaused(state: Paused, event: Exclude<AutoScrollEvent, { type: "disposed" }>) {
  switch (event.type) {
    case "working.changed":
      return to(event.working === state.working ? state : paused(event.working, state.detached), NONE)
    // A new viewport is measured only once it renders; the first `resize` ends the pause if it cannot scroll.
    case "scroller.changed":
      return to(paused(state.working, false), NONE)
    case "scroller.detached":
      return to(state.detached ? state : paused(state.working, true), NONE)
    case "scroller.reattached":
      if (!state.detached) return to(state, NONE)

      return to(event.overflow ? paused(state.working, false) : resumed(state, false), NONE)
    case "resize":
    case "pause":
      if (state.detached || event.overflow) return to(state, NONE)

      return to(resumed(state, false), NONE)
    case "scroll":
      if (state.detached || !atBottom(event)) return to(state, NONE)

      return to(resumed(state, false), NONE)
    case "scroll.bottom":
      if (!event.force) return to(state, NONE)

      return to(resumed(state, state.detached), state.detached ? NONE : PIN)
    case "settle.elapsed":
    case "flight.started":
      return to(state, NONE)
  }
}

function transitionUnpaused(
  state: Unpaused,
  event: Exclude<AutoScrollEvent, { type: "disposed" }>,
): AutoScrollTransition {
  switch (event.type) {
    case "working.changed":
      if (event.working && state.status === "following") return to(state, NONE)

      if (event.working) return to(unpaused("following", 0, state.detached, state.flight), follow(state))

      if (state.status !== "following") return to(state, NONE)

      return {
        state: unpaused("settling", event.attempt, state.detached, state.flight),
        effects: [{ type: "settle.start", attempt: event.attempt }],
      }
    case "settle.elapsed":
      if (state.status !== "settling" || state.attempt !== event.attempt) return to(state, NONE)

      return to(unpaused("idle", 0, state.detached, state.flight), NONE)
    case "scroller.changed":
      return to(patch(state, false, undefined), event.overflow ? PIN : NONE)
    case "scroller.detached":
      return to(patch(state, true, undefined), NONE)
    case "scroller.reattached":
      if (!state.detached) return to(state, NONE)

      return to(patch(state, false, state.flight), event.overflow ? PIN : NONE)
    case "resize":
      if (state.detached || !event.overflow) return to(state, NONE)

      return to(state, PIN)
    case "scroll":
      if (state.detached) return to(state, NONE)

      if (atBottom(event)) return to(patch(state, false, undefined), NONE)

      // Content grew between our write and its `scroll` event: catch up instead of reading it as the user.
      if (state.flight !== undefined && Math.abs(event.scrollTop - state.flight) <= END_EPSILON)
        return to(patch(state, false, undefined), PIN)

      return pause(state)
    case "pause":
      if (state.detached || !event.overflow) return to(state, NONE)

      return pause(state)
    case "scroll.bottom":
      return to(state, state.detached ? NONE : PIN)
    case "flight.started":
      if (state.detached) return to(state, NONE)

      return to(patch(state, false, event.top), NONE)
  }
}

function atBottom(event: Extract<AutoScrollEvent, { type: "scroll" }>) {
  return !event.overflow || event.maxScroll - event.scrollTop < event.threshold
}

function pause(state: Unpaused) {
  return to(paused(state.status === "following", false), state.status === "settling" ? STOP_AND_PAUSE : PAUSE)
}

function follow(state: Unpaused) {
  if (state.status === "settling") return state.detached ? STOP : STOP_AND_PIN

  return state.detached ? NONE : PIN
}

function to(state: AutoScrollState, effects: readonly AutoScrollEffect[]): AutoScrollTransition {
  const cached = effects === NONE ? KEEP.get(state) : effects === PIN ? PINNED.get(state) : undefined

  return cached ?? { state, effects }
}

function patch(state: Unpaused, detached: boolean, flight: number | undefined) {
  if (state.detached === detached && state.flight === flight) return state

  return unpaused(state.status, state.status === "settling" ? state.attempt : 0, detached, flight)
}

function unpaused(
  status: Unpaused["status"],
  attempt: number,
  detached: boolean,
  flight: number | undefined,
): AutoScrollState {
  if (status === "settling") return { status, attempt, detached, flight }

  if (!detached && flight === undefined) return status === "idle" ? IDLE : FOLLOWING

  return { status, detached, flight }
}

function paused(working: boolean, detached: boolean): AutoScrollState {
  if (!detached) return working ? PAUSED_WORKING : PAUSED_IDLE

  return { status: "paused", working, detached }
}

function resumed(state: Paused, detached: boolean) {
  return unpaused(state.working ? "following" : "idle", 0, detached, undefined)
}
