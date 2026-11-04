// Distance from the bottom that counts as "at the end". Deliberately tight: a collapse clamps
// exactly to the end, while a one-pixel nudge upward is a deliberate move away from it.
export const END_EPSILON = 0.5

// Chrome rounds scrollHeight and clientHeight to whole pixels but scrolls in zoomed ones, so under page zoom (down to
// 25%) the furthest offset it reaches can sit up to 4px short of scrollHeight - clientHeight.
export const ZOOM_SLACK = 4

// A scroll range at or below this does not overflow.
export const MIN_OVERFLOW = 1

/** A revealed tool call (`partID`) or the unread-messages notice, whose top edge stays put until the reader scrolls. */
export type FollowAnchor = { readonly key: string; readonly partID?: string }

/**
 * The reader's contact with the timeline. A held pointer or touch is what separates the reader's own upward scroll
 * from the virtualizer's measurement adjustments. Touch momentum keeps scrolling after the finger lifts, until the
 * scroll settles. A nested touch starts in a nested scrollport, which owns the drag until it chains into the timeline.
 */
export type FollowGesture = "pointer" | "touch" | "nested-touch" | "momentum"

export type FollowState =
  /** Holds the newest content at the bottom of the view. */
  | { readonly type: "following"; readonly gesture?: FollowGesture }
  /** Follows, with a scroll to the end queued for the next frame. */
  | { readonly type: "returning"; readonly attempt: number; readonly gesture?: FollowGesture }
  /** Stays where the reader is. `endPending`: a scroll landed within the zoom slack of the end and may have reached it. */
  | { readonly type: "detached"; readonly gesture?: FollowGesture; readonly endPending: boolean }
  /** Holds a revealed tool call or the unread-messages notice in place. */
  | { readonly type: "anchored"; readonly anchor: FollowAnchor }

export type FollowEvent =
  /** A programmatic scroll to the end, such as a route change or a growing composer at the end. */
  | { readonly type: "follow" }
  /** A scroll to the end is queued for the next frame. */
  | { readonly type: "return.start"; readonly attempt: number }
  /** The queued frame runs; the scroll to the end goes ahead only if this attempt is still current. */
  | { readonly type: "return.run"; readonly attempt: number }
  /** Navigation or selection that must keep the view where it is, whether or not the content overflows yet. */
  | { readonly type: "detach" }
  | { readonly type: "anchor"; readonly anchor: FollowAnchor }
  /** A programmatic scroll takes over: the anchor and any touch momentum go. */
  | { readonly type: "release" }
  /** Wheel, scroll key or page. Only an upward one over overflowing content stops following. */
  | { readonly type: "scroll.intent"; readonly upward: boolean; readonly overflow: boolean }
  | { readonly type: "pointer.down" }
  /** The pointer is released, cancelled, or the window lost it (blur, hidden). */
  | { readonly type: "pointer.up" }
  | { readonly type: "touch.start"; readonly nested: boolean }
  /** The finger drags the content downward, revealing earlier messages. */
  | { readonly type: "touch.drag"; readonly overflow: boolean }
  | { readonly type: "touch.end"; readonly scrolling: boolean }
  | {
      readonly type: "scroll"
      readonly scrollTop: number
      readonly previousTop: number
      readonly maxScroll: number
      readonly previousMaxScroll: number
    }
  /** The scroll came to rest. `atReachableEnd` is probed only when `needsEndProbe` asks for it. */
  | { readonly type: "scroll.settled"; readonly atReachableEnd: boolean }

type Unanchored = Exclude<FollowState, { type: "anchored" }>

const FOLLOWING: FollowState = Object.freeze({ type: "following" })
const DETACHED: FollowState = Object.freeze({ type: "detached", endPending: false })

export function createFollowState(): FollowState {
  return FOLLOWING
}

// Returns the same state when nothing changes, so a steady scroll writes no signal.
export function transitionFollow(state: FollowState, event: FollowEvent): FollowState {
  if (event.type === "anchor") return { type: "anchored", anchor: event.anchor }

  if (event.type === "return.start")
    return {
      type: "returning",
      attempt: event.attempt,
      gesture: state.type === "anchored" ? undefined : contact(state.gesture),
    }

  if (event.type === "return.run")
    return state.type === "returning" && state.attempt === event.attempt ? following(state.gesture) : state

  if (event.type === "follow") {
    if (state.type === "anchored") return FOLLOWING

    if (state.type === "detached") return following(contact(state.gesture))

    return state.type === "following" ? withGesture(state, contact(state.gesture)) : state
  }

  if (state.type === "anchored") return releaseAnchor(state, event)

  if (event.type === "detach") return state.type === "detached" ? state : detached(state.gesture, false)

  if (event.type === "release") return withGesture(state, contact(state.gesture))

  if (event.type === "scroll.intent")
    return event.upward && event.overflow && state.type !== "detached" ? detached(state.gesture, false) : state

  if (event.type === "pointer.down") return touchHeld(state.gesture) ? state : withGesture(state, "pointer")

  if (event.type === "pointer.up") return state.gesture === "pointer" ? withGesture(state, undefined) : state

  if (event.type === "touch.start") return withGesture(state, event.nested ? "nested-touch" : "touch")

  // A nested scrollport owns its drag. If it chains into the timeline, the timeline's own upward scroll detaches.
  if (event.type === "touch.drag")
    return state.type !== "detached" && state.gesture === "touch" && event.overflow ? detached("touch", false) : state

  if (event.type === "touch.end")
    return touchHeld(state.gesture) ? withGesture(state, event.scrolling ? "momentum" : undefined) : state

  if (event.type === "scroll") return scrolled(state, event)

  return settled(state, event.atReachableEnd)
}

export function isFollowing(state: FollowState) {
  return state.type === "following" || state.type === "returning"
}

export function followAnchor(state: FollowState) {
  return state.type === "anchored" ? state.anchor : undefined
}

// iOS defers native scroll writes until momentum ends, so a detached touch scroll keeps its visual anchor by deferring
// size compensation until then.
export function defersAdjustments(state: FollowState) {
  return state.type === "detached" && !!state.gesture && state.gesture !== "pointer"
}

// Probing the zoomed end writes scrollTop, so it waits for a settled scroll and a lifted finger.
export function needsEndProbe(state: FollowState) {
  return state.type === "detached" && state.endPending && !touchHeld(state.gesture)
}

// Only the reader's own input lets an anchored tool go.
function releaseAnchor(state: FollowState, event: FollowEvent): FollowState {
  if (event.type === "release" || event.type === "scroll.intent") return DETACHED

  if (event.type === "pointer.down") return detached("pointer", false)

  if (event.type === "touch.start") return detached(event.nested ? "nested-touch" : "touch", false)

  return state
}

// Following resumes by arriving at the end, either by scrolling there or by content shrinking under a viewport that
// was already there. Merely resting near the end is not enough, otherwise a later scroll would overwrite an upward
// intent expressed a pixel short of the bottom.
function scrolled(state: Unanchored, event: Extract<FollowEvent, { type: "scroll" }>): FollowState {
  const arrived = event.scrollTop > event.previousTop + END_EPSILON || event.maxScroll < event.previousMaxScroll
  const movedUp = event.scrollTop < event.previousTop - END_EPSILON

  const atEnd =
    (event.maxScroll <= MIN_OVERFLOW && event.previousMaxScroll > MIN_OVERFLOW) ||
    (arrived && event.maxScroll - event.scrollTop <= END_EPSILON)

  // Upward input is the one intent geometry cannot recover: a held pointer or touch moving the view up is the
  // reader's, while an upward shift without one is the virtualizer compensating a size change.
  if (state.type !== "detached") return !atEnd && movedUp && state.gesture ? detached(state.gesture, false) : state

  if (atEnd) return following(state.gesture)

  // Probing the zoomed end now would cancel a scroll still in motion, so it waits for the scroll to settle.
  const endPending =
    arrived && event.maxScroll - event.scrollTop <= ZOOM_SLACK && !(movedUp && state.gesture)
      ? true
      : event.scrollTop < event.previousTop
        ? false
        : state.endPending

  return endPending === state.endPending ? state : detached(state.gesture, endPending)
}

function settled(state: Unanchored, atReachableEnd: boolean): FollowState {
  if (touchHeld(state.gesture)) return state
  const gesture = contact(state.gesture)

  if (state.type !== "detached" || !state.endPending) return withGesture(state, gesture)

  return atReachableEnd ? following(gesture) : detached(gesture, false)
}

function following(gesture: FollowGesture | undefined): FollowState {
  return gesture ? { type: "following", gesture } : FOLLOWING
}

function detached(gesture: FollowGesture | undefined, endPending: boolean): FollowState {
  return gesture || endPending ? { type: "detached", gesture, endPending } : DETACHED
}

function withGesture(state: Unanchored, gesture: FollowGesture | undefined): FollowState {
  if (state.gesture === gesture) return state

  if (state.type === "following") return following(gesture)

  if (state.type === "detached") return detached(gesture, state.endPending)

  return { ...state, gesture }
}

// Keeps a gesture only while the reader is still in contact; momentum ends.
function contact(gesture: FollowGesture | undefined) {
  return gesture === "momentum" ? undefined : gesture
}

function touchHeld(gesture: FollowGesture | undefined) {
  return gesture === "touch" || gesture === "nested-touch"
}
