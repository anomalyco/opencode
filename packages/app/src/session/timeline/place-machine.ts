import type { Place } from "./place"

// How long a return holds the view at its place. Rows mount, measure and render over that time, and the header and
// the composer settle, and each of those can move the place again. Past it the view stays where it is.
export const PLACE_RETURN_TIMEOUT = 3_000

/**
 * A reader's return to the place they left. The place is known at once, but its rows mount, measure and render over
 * the next frames. `returning` puts the view there again on each frame and after each batch of sizes, until the time
 * is up or the reader moves the view themselves.
 */
export type PlaceReturnState =
  | { readonly status: "resting"; readonly attempt: number }
  | { readonly status: "returning"; readonly attempt: number; readonly place: Place }

export type PlaceReturnEvent =
  /** The view is on screen again. `place`: where its reader was, when they had left the end. */
  | { readonly type: "returned"; readonly place: Place | undefined }
  /** A frame passed, or rows changed size: the view is put at its place again. */
  | { readonly type: "rendered" }
  /** The view was put at its place. `end`: the passage is gone from the session, and the view went to the end. */
  | { readonly type: "looked"; readonly attempt: number; readonly end: boolean }
  | { readonly type: "timeout"; readonly attempt: number }
  /** The reader, or navigation, moved the view. That wins over a place that has not been reached yet. */
  | { readonly type: "taken" }
  /** The view went away again, or was disposed. */
  | { readonly type: "left" }

export type PlaceReturnEffect =
  | { readonly type: "look"; readonly attempt: number; readonly place: Place }
  | { readonly type: "frame.schedule"; readonly attempt: number }
  | { readonly type: "timer.start"; readonly attempt: number }
  /** Ends the frame and the timer of a return. */
  | { readonly type: "cancel" }

export type PlaceReturnTransition = {
  readonly state: PlaceReturnState
  readonly effects: readonly PlaceReturnEffect[]
}

// Shared events for the frequent dispatches, so a scroll or a batch of sizes allocates nothing.
export const PLACE_RENDERED_EVENT: PlaceReturnEvent = Object.freeze({ type: "rendered" })

export const PLACE_TAKEN_EVENT: PlaceReturnEvent = Object.freeze({ type: "taken" })

export const PLACE_LEFT_EVENT: PlaceReturnEvent = Object.freeze({ type: "left" })

const NO_EFFECTS: readonly PlaceReturnEffect[] = Object.freeze([])

const CANCEL: readonly PlaceReturnEffect[] = Object.freeze([{ type: "cancel" }])

export function createPlaceReturnState(): PlaceReturnState {
  return { status: "resting", attempt: 0 }
}

export function transitionPlaceReturn(state: PlaceReturnState, event: PlaceReturnEvent): PlaceReturnTransition {
  if (event.type === "returned") {
    if (!event.place) return rest(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "returning", attempt, place: event.place },
      effects: [
        ...(state.status === "returning" ? CANCEL : NO_EFFECTS),
        { type: "timer.start", attempt },
        { type: "look", attempt, place: event.place },
      ],
    }
  }

  if (state.status === "resting") return unchanged(state)

  if (event.type === "taken" || event.type === "left") return rest(state)

  if (event.type === "rendered")
    return { state, effects: [{ type: "look", attempt: state.attempt, place: state.place }] }

  if (event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "timeout" || event.end) return rest(state)

  return { state, effects: [{ type: "frame.schedule", attempt: state.attempt }] }
}

/** The place a return is still on its way to. A view that goes away meanwhile keeps it as its reader's place. */
export function returningPlace(state: PlaceReturnState) {
  return state.status === "returning" ? state.place : undefined
}

function rest(state: PlaceReturnState): PlaceReturnTransition {
  if (state.status === "resting") return unchanged(state)

  return { state: { status: "resting", attempt: state.attempt + 1 }, effects: CANCEL }
}

// One transition for each state, so an event that does not apply allocates nothing: the reader's scroll sends one.
const quiet = new WeakMap<PlaceReturnState, PlaceReturnTransition>()

function unchanged(state: PlaceReturnState): PlaceReturnTransition {
  const known = quiet.get(state)

  if (known) return known
  const transition = { state, effects: NO_EFFECTS }
  quiet.set(state, transition)

  return transition
}
