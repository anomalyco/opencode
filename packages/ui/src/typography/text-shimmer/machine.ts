/** Matches the opacity crossfade in `text-shimmer.css`; the sweep keeps running until the shimmer layer has faded. */
export const TEXT_SHIMMER_SWAP_MS = 220

/**
 * `active` shows the shimmer layer and runs its sweep. `fading` has already crossfaded back to the plain text and only
 * keeps the sweep running until the fade ends, so the layer never freezes mid-fade. `inactive` runs nothing.
 */
export type TextShimmerState =
  | { readonly status: "inactive"; readonly attempts: number }
  | { readonly status: "active"; readonly attempts: number }
  | { readonly status: "fading"; readonly attempt: number }
  | { readonly status: "disposed" }

export type TextShimmerEvent =
  | { readonly type: "sync"; readonly active: boolean; readonly reducedMotion: boolean }
  | { readonly type: "settled"; readonly attempt: number }
  | { readonly type: "disposed" }

// Every timeline row mounts a shimmer, so mounting, syncing and disposing reuse these instead of allocating.
export const INITIAL_INACTIVE_TEXT_SHIMMER_STATE: TextShimmerState = Object.freeze({ status: "inactive", attempts: 0 })

export const INITIAL_ACTIVE_TEXT_SHIMMER_STATE: TextShimmerState = Object.freeze({ status: "active", attempts: 0 })

export const DISPOSED_TEXT_SHIMMER_STATE: TextShimmerState = Object.freeze({ status: "disposed" })

export const DISPOSED_TEXT_SHIMMER_EVENT: TextShimmerEvent = Object.freeze({ type: "disposed" })

const SYNC_ACTIVE: TextShimmerEvent = Object.freeze({ type: "sync", active: true, reducedMotion: false })

const SYNC_ACTIVE_REDUCED: TextShimmerEvent = Object.freeze({ type: "sync", active: true, reducedMotion: true })

const SYNC_INACTIVE: TextShimmerEvent = Object.freeze({ type: "sync", active: false, reducedMotion: false })

const SYNC_INACTIVE_REDUCED: TextShimmerEvent = Object.freeze({ type: "sync", active: false, reducedMotion: true })

export function syncTextShimmerEvent(active: boolean, reducedMotion: boolean): TextShimmerEvent {
  if (active) return reducedMotion ? SYNC_ACTIVE_REDUCED : SYNC_ACTIVE

  return reducedMotion ? SYNC_INACTIVE_REDUCED : SYNC_INACTIVE
}

export function createTextShimmerState(active: boolean): TextShimmerState {
  return active ? INITIAL_ACTIVE_TEXT_SHIMMER_STATE : INITIAL_INACTIVE_TEXT_SHIMMER_STATE
}

export function transitionTextShimmer(state: TextShimmerState, event: TextShimmerEvent): TextShimmerState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_TEXT_SHIMMER_STATE

  if (event.type === "settled") {
    if (state.status !== "fading" || event.attempt !== state.attempt) return state

    return { status: "inactive", attempts: state.attempt }
  }

  if (state.status === "inactive") {
    if (!event.active) return state

    return state.attempts === 0 ? INITIAL_ACTIVE_TEXT_SHIMMER_STATE : { status: "active", attempts: state.attempts }
  }

  if (state.status === "active") {
    if (event.active) return state

    // Reduced motion turns the crossfade off, so there is nothing to wait for.
    if (event.reducedMotion)
      return state.attempts === 0 ? INITIAL_INACTIVE_TEXT_SHIMMER_STATE : { status: "inactive", attempts: state.attempts }

    return { status: "fading", attempt: state.attempts + 1 }
  }

  if (event.active) return { status: "active", attempts: state.attempt }

  if (event.reducedMotion) return { status: "inactive", attempts: state.attempt }

  return state
}

/** Whether the shimmer layer is shown; drives the opacity crossfade. */
export function selectTextShimmerActive(state: TextShimmerState) {
  return state.status === "active"
}

/** Whether the sweep animation runs; it outlives `active` by the crossfade. */
export function selectTextShimmerRunning(state: TextShimmerState) {
  return state.status === "active" || state.status === "fading"
}
