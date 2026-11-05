// Frames a seek waits for the target prompt's virtualized row to mount.
export const CURSOR_SEEK_LIMIT = 4

export type CursorSeek = {
  readonly behavior: ScrollBehavior
  readonly retries: number
}

// `attempt` advances on every change of target or seek, so a seek result from an earlier one is ignored.
export type TimelineCursorState =
  | { readonly status: "none"; readonly attempt: number }
  /** A `#message-<id>` target that is not loaded yet; history pages toward it. */
  | { readonly status: "pending"; readonly messageID: string; readonly attempt: number }
  /**
   * The active prompt. `fresh` until the reader scrolls, after which navigation steps from the prompt in view instead.
   * `seek` while the view is still bringing the prompt in.
   */
  | {
      readonly status: "selected"
      readonly messageID: string
      readonly fresh: boolean
      readonly attempt: number
      readonly seek?: CursorSeek
    }

export type TimelineCursorEvent =
  | { readonly type: "session.changed" }
  /**
   * The route hash, applied once the session's messages are ready (`initial`) and on every later change. `messageID` is
   * the `#message-<id>` target. `reveal`: the route opens the session on a tool call instead.
   */
  | {
      readonly type: "hash.applied"
      readonly hash: string
      readonly messageID: string | undefined
      readonly initial: boolean
      readonly reveal: boolean
    }
  | { readonly type: "target.loaded"; readonly messageID: string }
  /** Previous or next message. */
  | { readonly type: "message.jump"; readonly messageID: string; readonly behavior: ScrollBehavior }
  /** Undo, redo and rewind name the prompt navigation continues from. */
  | { readonly type: "message.select"; readonly messageID: string | undefined; readonly following: boolean }
  /** The reader scrolled the timeline, or Find or a tool reveal moved it. */
  | { readonly type: "scroll.moved" }
  /** Following resumed, or the reader jumped to the latest message. */
  | { readonly type: "clear" }
  | { readonly type: "latest.advanced" }
  | { readonly type: "seek.landed"; readonly attempt: number }
  | { readonly type: "seek.missing"; readonly attempt: number }
  | { readonly type: "disposed" }

export type TimelineCursorEffect =
  | { readonly type: "follow.detach" }
  /** Follow the newest content again and scroll to it. */
  | { readonly type: "follow.end" }
  | { readonly type: "hash.set"; readonly messageID: string }
  | { readonly type: "hash.clear" }
  /** Scroll to the element a non-message hash names, or to the end when there is none. */
  | { readonly type: "anchor.scroll"; readonly id: string }
  /** Scroll now: a smooth jump glides to a mounted prompt, any other first asks the virtualizer to reveal it. */
  | {
      readonly type: "seek.start"
      readonly attempt: number
      readonly messageID: string
      readonly behavior: ScrollBehavior
    }
  | {
      readonly type: "seek.schedule"
      readonly attempt: number
      readonly messageID: string
      readonly behavior: ScrollBehavior
    }
  | { readonly type: "seek.cancel" }

export type TimelineCursorTransition = {
  readonly state: TimelineCursorState
  readonly effects: readonly TimelineCursorEffect[]
}

type Selected = Extract<TimelineCursorState, { readonly status: "selected" }>

// Shared events for the frequent dispatches, so scrolling allocates nothing.
export const SCROLL_MOVED_EVENT: TimelineCursorEvent = Object.freeze({ type: "scroll.moved" })

export const CLEAR_CURSOR_EVENT: TimelineCursorEvent = Object.freeze({ type: "clear" })

export const LATEST_ADVANCED_EVENT: TimelineCursorEvent = Object.freeze({ type: "latest.advanced" })

export const SESSION_CHANGED_EVENT: TimelineCursorEvent = Object.freeze({ type: "session.changed" })

export const DISPOSED_CURSOR_EVENT: TimelineCursorEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly TimelineCursorEffect[] = Object.freeze([])

const SEEK_CANCEL: readonly TimelineCursorEffect[] = Object.freeze([{ type: "seek.cancel" }])

const FOLLOW_END: TimelineCursorEffect = Object.freeze({ type: "follow.end" })

const FOLLOW_DETACH: TimelineCursorEffect = Object.freeze({ type: "follow.detach" })

const HASH_CLEAR: TimelineCursorEffect = Object.freeze({ type: "hash.clear" })

export function createTimelineCursorState(): TimelineCursorState {
  return { status: "none", attempt: 0 }
}

export function transitionTimelineCursor(
  state: TimelineCursorState,
  event: TimelineCursorEvent,
): TimelineCursorTransition {
  if (event.type === "session.changed" || event.type === "disposed") return clear(state)

  if (event.type === "hash.applied") return hashApplied(state, event)

  if (event.type === "target.loaded") {
    if (state.status !== "pending" || state.messageID !== event.messageID) return unchanged(state)

    return seek(
      state,
      event.messageID,
      "auto",
      [FOLLOW_DETACH, { type: "hash.set", messageID: event.messageID }],
      false,
    )
  }

  if (event.type === "message.jump")
    return seek(state, event.messageID, event.behavior, [
      ...cancelSeek(state),
      FOLLOW_DETACH,
      { type: "hash.set", messageID: event.messageID },
    ])

  if (event.type === "message.select") {
    // A pinned view shows the newest prompt; a remembered one would only send navigation elsewhere.
    if (!event.messageID || event.following) return clear(state)

    if (state.status === "selected" && state.messageID === event.messageID && state.fresh && !state.seek)
      return unchanged(state)

    return changed(
      { status: "selected", messageID: event.messageID, fresh: true, attempt: state.attempt + 1 },
      cancelSeek(state),
    )
  }

  if (event.type === "scroll.moved") {
    if (state.status !== "selected" || !hasFreshCursorOrSeek(state)) return unchanged(state)

    return changed(
      { status: "selected", messageID: state.messageID, fresh: false, attempt: state.attempt + 1 },
      cancelSeek(state),
    )
  }

  if (event.type === "clear") {
    const next = clear(state)

    return changed(next.state, [...next.effects, HASH_CLEAR])
  }

  if (event.type === "latest.advanced") return state.status === "selected" ? clear(state) : unchanged(state)

  if (state.status !== "selected" || !state.seek || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "seek.landed" || state.seek.retries >= CURSOR_SEEK_LIMIT) return changed(settled(state))

  return changed({ ...state, seek: { behavior: state.seek.behavior, retries: state.seek.retries + 1 } }, [
    { type: "seek.schedule", attempt: state.attempt, messageID: state.messageID, behavior: state.seek.behavior },
  ])
}

/** The prompt navigation steps from, while the reader has not scrolled since choosing it. */
export function freshCursorMessageID(state: TimelineCursorState) {
  return state.status === "selected" && state.fresh ? state.messageID : undefined
}

/** The last chosen prompt, for when no prompt header is mounted in view. */
export function cursorMessageID(state: TimelineCursorState) {
  return state.status === "selected" ? state.messageID : undefined
}

/** A target history pages toward until it loads. */
export function pendingCursorMessageID(state: TimelineCursorState) {
  return state.status === "pending" ? state.messageID : undefined
}

/** Only a fresh cursor or a running seek cares about the reader's scroll, so steady scrolling skips the rest. */
export function hasFreshCursorOrSeek(state: TimelineCursorState) {
  return state.status === "selected" && (state.fresh || !!state.seek)
}

function hashApplied(
  state: TimelineCursorState,
  event: Extract<TimelineCursorEvent, { type: "hash.applied" }>,
): TimelineCursorTransition {
  if (event.messageID) {
    // The hash this cursor set itself, echoed back by the router.
    if (state.status !== "none" && state.messageID === event.messageID) return unchanged(state)

    return changed({ status: "pending", messageID: event.messageID, attempt: state.attempt + 1 }, [
      ...cancelSeek(state),
      FOLLOW_DETACH,
    ])
  }

  if (event.hash) {
    const next = clear(state)

    return changed(next.state, [...next.effects, { type: "anchor.scroll", id: event.hash }])
  }

  // A hash this cursor cleared itself leaves it at `none`, so the echo does not undo a smooth return to the end.
  if (state.status === "none" && !event.initial) return unchanged(state)
  const next = clear(state)

  if (event.reveal) return next

  return changed(next.state, [...next.effects, FOLLOW_END])
}

function seek(
  state: TimelineCursorState,
  messageID: string,
  behavior: ScrollBehavior,
  effects: readonly TimelineCursorEffect[],
  now = true,
): TimelineCursorTransition {
  const attempt = state.attempt + 1

  return changed({ status: "selected", messageID, fresh: true, attempt, seek: { behavior, retries: 0 } }, [
    ...effects,
    { type: now ? "seek.start" : "seek.schedule", attempt, messageID, behavior },
  ])
}

function settled(state: Selected): TimelineCursorState {
  return { status: "selected", messageID: state.messageID, fresh: state.fresh, attempt: state.attempt }
}

function clear(state: TimelineCursorState): TimelineCursorTransition {
  if (state.status === "none") return unchanged(state)

  return changed({ status: "none", attempt: state.attempt + 1 }, cancelSeek(state))
}

function cancelSeek(state: TimelineCursorState) {
  return state.status === "selected" && state.seek ? SEEK_CANCEL : NO_EFFECTS
}

function changed(
  state: TimelineCursorState,
  effects: readonly TimelineCursorEffect[] = NO_EFFECTS,
): TimelineCursorTransition {
  return { state, effects }
}

function unchanged(state: TimelineCursorState): TimelineCursorTransition {
  return { state, effects: NO_EFFECTS }
}
