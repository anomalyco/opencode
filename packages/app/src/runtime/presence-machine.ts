/** Exit length assumed when the computed styles report no duration. */
export const PRESENCE_DEFAULT_EXIT_MS = 250

/** Slack past the computed CSS duration and delay before the fallback timer hides the element. */
export const PRESENCE_EXIT_GRACE_MS = 50

export type PresencePhase = "present" | "hiding" | "hidden"

/** What the element's computed styles say about its exit, read once when `show` turns false. */
export type PresenceExit =
  | { readonly kind: "none" }
  | { readonly kind: "animation"; readonly names: string; readonly count: number; readonly timeoutMs: number }
  | { readonly kind: "transition"; readonly count: number; readonly timeoutMs: number }

// `pending` is mutable: an intermediate `animationend` or `transitionend` counts down in place and returns the same
// state, so a multi-part exit allocates nothing and writes no signal until its last part ends.
export type PresenceState =
  | {
      readonly status: "present"
      readonly attempt: number
      /** The element's `animation-name` list when an animation last started, or `"none"`. */
      readonly started: string
    }
  | {
      readonly status: "hiding"
      readonly attempt: number
      readonly kind: "animation" | "transition"
      /** The `animation-name` list at hide time, or `"none"` for a transition exit. */
      readonly names: string
      /** Animations that were already running before the hide; their ends do not count. */
      readonly ignore: string
      readonly timeoutMs: number
      pending: number
    }
  | { readonly status: "hidden"; readonly attempt: number }
  | { readonly status: "disposed" }

export type PresenceEvent =
  | { readonly type: "show" }
  | { readonly type: "hide"; readonly exit: PresenceExit }
  // Mutable so the DOM listeners can reuse one event object per presence.
  | { type: "animation.started"; name: string; current: string }
  | { type: "animation.ended"; name: string }
  | { readonly type: "transition.ended" }
  | { readonly type: "element.changed" }
  | { readonly type: "reduced" }
  | { readonly type: "timeout"; readonly attempt: number }
  | { readonly type: "disposed" }

export const NO_EXIT: PresenceExit = Object.freeze({ kind: "none" })

export const SHOW_PRESENCE_EVENT: PresenceEvent = Object.freeze({ type: "show" })

export const HIDE_INSTANT_EVENT: PresenceEvent = Object.freeze({ type: "hide", exit: NO_EXIT })

export const TRANSITION_END_EVENT: PresenceEvent = Object.freeze({ type: "transition.ended" })

export const ELEMENT_CHANGED_EVENT: PresenceEvent = Object.freeze({ type: "element.changed" })

export const REDUCED_PRESENCE_EVENT: PresenceEvent = Object.freeze({ type: "reduced" })

export const DISPOSED_PRESENCE_EVENT: PresenceEvent = Object.freeze({ type: "disposed" })

export const DISPOSED_PRESENCE_STATE: PresenceState = Object.freeze({ status: "disposed" })

export function createPresenceState(show: boolean): PresenceState {
  return show ? { status: "present", attempt: 0, started: "none" } : { status: "hidden", attempt: 0 }
}

export function transitionPresence(state: PresenceState, event: PresenceEvent): PresenceState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_PRESENCE_STATE

  if (event.type === "show")
    return state.status === "present" ? state : { status: "present", attempt: state.attempt, started: "none" }

  if (state.status === "hidden") return state

  if (event.type === "hide") return hide(state, event.exit)

  if (state.status === "present") {
    if (event.type === "animation.started")
      return hasCssToken(event.current, event.name) && state.started !== event.current
        ? { status: "present", attempt: state.attempt, started: event.current }
        : state

    // A new element has not run the old element's animations, so its exit must not skip them.
    if (event.type === "element.changed")
      return state.started === "none" ? state : { status: "present", attempt: state.attempt, started: "none" }

    return state
  }

  if (event.type === "animation.ended") {
    if (state.kind !== "animation" || !hasCssToken(state.names, event.name) || hasCssToken(state.ignore, event.name))
      return state

    return settle(state)
  }

  if (event.type === "transition.ended") return state.kind === "transition" ? settle(state) : state

  if (event.type === "timeout")
    return event.attempt === state.attempt ? { status: "hidden", attempt: state.attempt } : state

  // The element was swapped or unmounted, or Reduce Motion turned on: no end event will come, or none should be waited for.
  if (event.type === "element.changed" || event.type === "reduced") return { status: "hidden", attempt: state.attempt }

  return state
}

function hide(state: Extract<PresenceState, { status: "present" | "hiding" }>, exit: PresenceExit): PresenceState {
  if (exit.kind === "none") return { status: "hidden", attempt: state.attempt }

  if (state.status === "hiding") return state

  return {
    status: "hiding",
    attempt: state.attempt + 1,
    kind: exit.kind,
    names: exit.kind === "animation" ? exit.names : "none",
    ignore: state.started,
    timeoutMs: exit.timeoutMs,
    pending: exit.count,
  }
}

function settle(state: Extract<PresenceState, { status: "hiding" }>): PresenceState {
  if (state.pending <= 1) return { status: "hidden", attempt: state.attempt }
  state.pending--

  return state
}

export function selectPresencePhase(state: PresenceState): PresencePhase {
  return state.status === "disposed" ? "hidden" : state.status
}

export function selectPresent(state: PresenceState): boolean {
  return state.status === "present" || state.status === "hiding"
}

export type AnimatedPresenceState<T> =
  | {
      readonly status: "shown"
      readonly attempt: number
      readonly identity: unknown
      readonly value: T
      readonly animate: boolean
      readonly shownAt: number
    }
  | {
      readonly status: "lingering"
      readonly attempt: number
      readonly identity: unknown
      readonly value: T
      readonly animate: boolean
      readonly shownAt: number
      readonly delayMs: number
    }
  | {
      readonly status: "hidden"
      readonly attempt: number
      readonly identity: unknown
      /** The last value shown for this identity, kept for the exit animation. */
      readonly value: T | undefined
      readonly animate: boolean
    }

export type AnimatedPresenceEvent<T> =
  | {
      readonly type: "sync"
      readonly value: T | undefined
      readonly identity: unknown
      readonly hasIdentity: boolean
      readonly minimumDuration: number
      readonly now: number
    }
  | { readonly type: "linger.elapsed"; readonly attempt: number }

export function createAnimatedPresenceState<T>(input: {
  value: T | undefined
  identity: unknown
  now: number
}): AnimatedPresenceState<T> {
  if (input.value === undefined)
    return { status: "hidden", attempt: 0, identity: input.identity, value: undefined, animate: false }

  return {
    status: "shown",
    attempt: 0,
    identity: input.identity,
    value: input.value,
    animate: false,
    shownAt: input.now,
  }
}

export function transitionAnimatedPresence<T>(
  state: AnimatedPresenceState<T>,
  event: AnimatedPresenceEvent<T>,
): AnimatedPresenceState<T> {
  if (event.type === "linger.elapsed") {
    if (state.status !== "lingering" || event.attempt !== state.attempt) return state

    return { status: "hidden", attempt: state.attempt, identity: state.identity, value: state.value, animate: true }
  }

  // Another identity starts fresh and without animation: the previous identity's exit and value do not carry over.
  if (event.hasIdentity && state.identity !== event.identity) {
    const attempt = state.attempt + 1

    if (event.value === undefined)
      return { status: "hidden", attempt, identity: event.identity, value: undefined, animate: false }

    return {
      status: "shown",
      attempt,
      identity: event.identity,
      value: event.value,
      animate: false,
      shownAt: event.now,
    }
  }

  if (state.status === "hidden") {
    if (event.value === undefined) return state

    return {
      status: "shown",
      attempt: state.attempt,
      identity: state.identity,
      value: event.value,
      animate: true,
      shownAt: event.now,
    }
  }

  if (event.value !== undefined) {
    if (state.status === "shown" && Object.is(state.value, event.value)) return state

    return {
      status: "shown",
      attempt: state.attempt,
      identity: state.identity,
      value: event.value,
      animate: state.animate,
      shownAt: state.shownAt,
    }
  }

  if (state.status === "lingering") return state

  const remaining = event.minimumDuration - (event.now - state.shownAt)

  if (remaining > 0)
    return {
      status: "lingering",
      attempt: state.attempt + 1,
      identity: state.identity,
      value: state.value,
      animate: state.animate,
      shownAt: state.shownAt,
      delayMs: remaining,
    }

  return { status: "hidden", attempt: state.attempt, identity: state.identity, value: state.value, animate: true }
}

export function selectAnimatedShow<T>(state: AnimatedPresenceState<T>): boolean {
  return state.status === "shown" || state.status === "lingering"
}

export function selectAnimatedAnimate<T>(state: AnimatedPresenceState<T>): boolean {
  return state.animate
}

export function selectAnimatedValue<T>(state: AnimatedPresenceState<T>): T | undefined {
  return state.value
}

/** Whether a comma-separated CSS list (`animation-name`) holds `token` exactly. Allocates nothing. */
export function hasCssToken(list: string, token: string): boolean {
  if (!token || token === "none" || !list || list === "none") return false
  let start = 0

  while (start <= list.length) {
    const comma = list.indexOf(",", start)
    const end = comma === -1 ? list.length : comma
    let from = start
    let to = end

    while (from < to && list.charCodeAt(from) <= 32) from++

    while (to > from && list.charCodeAt(to - 1) <= 32) to--

    if (to - from === token.length && list.startsWith(token, from)) return true

    if (comma === -1) return false
    start = comma + 1
  }

  return false
}

/** Animations in `names` that were not already running in `ignore`. */
export function countNewAnimations(names: string, ignore: string): number {
  return names
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name && name !== "none" && !hasCssToken(ignore, name)).length
}

/** The longest duration plus delay in milliseconds; CSS repeats the delay list to the length of the durations. */
export function maxCssTimeMs(durations: string, delays: string): number {
  const delay = delays.split(",").map(cssTimeMs)

  return Math.max(0, ...durations.split(",").map((value, index) => cssTimeMs(value) + delay[index % delay.length]))
}

function cssTimeMs(value: string) {
  const text = value.trim()
  const number = Number.parseFloat(text)

  if (!Number.isFinite(number)) return 0

  return text.endsWith("ms") ? number : number * 1000
}
