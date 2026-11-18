import { messageIdFromHash } from "../message-id-from-hash"
import type { HistorySeekStatus } from "./history-machine"

// Frames a seek waits for the target prompt's virtualized row to mount once the timeline is on screen.
export const CURSOR_SEEK_LIMIT = 12

export type CursorSeek = {
  readonly behavior: ScrollBehavior
  readonly retries: number
  /** The timeline is not on screen, so no frame probes it; showing it again starts the seek over. */
  readonly paused?: boolean
}

// `attempt` advances on every change of target, apply or seek, so a frame or result from an earlier one is ignored.
export type TimelineCursorState =
  /**
   * The route hash waits to apply: until the session's messages and the timeline are on screen, then for one frame
   * (`scheduled`) while the virtualizer registers its navigation. `initial`: the hash opened the session.
   */
  | {
      readonly status: "applying"
      readonly initial: boolean
      readonly scheduled: boolean
      readonly attempt: number
    }
  /** No prompt is chosen. `echo` after the cursor cleared the hash, until the router repeats the empty hash once. */
  | { readonly status: "none"; readonly attempt: number; readonly echo?: boolean }
  /**
   * A `#message-<id>` target that is not loaded yet; history pages toward it while it can still load. `endOnMiss`: a
   * target that never loads returns the view to the end, because the hash opened the session.
   */
  | {
      readonly status: "pending"
      readonly messageID: string
      readonly endOnMiss: boolean
      readonly attempt: number
    }
  /**
   * The active prompt. `fresh` until the reader scrolls, after which navigation steps from the prompt in view instead.
   * `seek` while the view is still bringing the prompt in. `echo` after a jump wrote the prompt's hash, until the router
   * repeats it once; any other `#message-<id>` for the prompt is a real navigation.
   */
  | {
      readonly status: "selected"
      readonly messageID: string
      readonly fresh: boolean
      readonly attempt: number
      readonly seek?: CursorSeek
      readonly echo?: boolean
    }

export type TimelineCursorEvent =
  | { readonly type: "session.changed" }
  /** The session's messages and the timeline are on screen (`view.ready`), or no longer are. */
  | { readonly type: "view.ready" }
  | { readonly type: "view.unready" }
  /** The route hash changed. `hash` is `location.hash` without its `#`. */
  | { readonly type: "hash.changed"; readonly hash: string; readonly viewReady: boolean }
  /** The frame an apply waited for. `reveal`: the route opens the session on a tool call instead. */
  | { readonly type: "hash.applied"; readonly attempt: number; readonly hash: string; readonly reveal: boolean }
  /** What decides whether a pending target can still load: the transcript, the revert boundary and history paging. */
  | {
      readonly type: "target.synced"
      readonly messageID: string
      readonly loaded: boolean
      readonly viewReady: boolean
      /** The transcript's first sync is still under way, so the loaded messages may not be the newest page yet. */
      readonly syncing: boolean
      readonly revertMessageID: string | undefined
      readonly oldestMessageID: string | undefined
      readonly history: HistorySeekStatus
      readonly hash: string
    }
  /** Previous or next message. `hash` is the route hash before the jump. */
  | {
      readonly type: "message.jump"
      readonly messageID: string
      readonly behavior: ScrollBehavior
      readonly hash: string
      readonly viewReady: boolean
    }
  /** Undo, redo and rewind name the prompt navigation continues from. */
  | { readonly type: "message.select"; readonly messageID: string | undefined; readonly following: boolean }
  /** The reader scrolled the timeline, or Find or a tool reveal moved it. */
  | { readonly type: "scroll.moved" }
  /** Following resumed, or the reader jumped to the latest message. `hash` is the route hash. */
  | { readonly type: "clear"; readonly hash: string }
  | { readonly type: "latest.advanced" }
  | { readonly type: "seek.landed"; readonly attempt: number }
  | { readonly type: "seek.missing"; readonly attempt: number }
  | { readonly type: "disposed" }

export type TimelineCursorEffect =
  /** Apply the route hash on the next frame. */
  | { readonly type: "apply.schedule"; readonly attempt: number }
  | { readonly type: "apply.cancel" }
  /** Load the next older page toward a pending target. */
  | { readonly type: "history.seek" }
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

type Pending = Extract<TimelineCursorState, { readonly status: "pending" }>

type Selected = Extract<TimelineCursorState, { readonly status: "selected" }>

// Shared events for the frequent dispatches, so scrolling allocates nothing.
export const SCROLL_MOVED_EVENT: TimelineCursorEvent = Object.freeze({ type: "scroll.moved" })

export const CLEAR_WITHOUT_HASH_EVENT: TimelineCursorEvent = Object.freeze({ type: "clear", hash: "" })

export const LATEST_ADVANCED_EVENT: TimelineCursorEvent = Object.freeze({ type: "latest.advanced" })

export const SESSION_CHANGED_EVENT: TimelineCursorEvent = Object.freeze({ type: "session.changed" })

export const VIEW_READY_EVENT: TimelineCursorEvent = Object.freeze({ type: "view.ready" })

export const VIEW_UNREADY_EVENT: TimelineCursorEvent = Object.freeze({ type: "view.unready" })

export const DISPOSED_CURSOR_EVENT: TimelineCursorEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly TimelineCursorEffect[] = Object.freeze([])

const SEEK_CANCEL: readonly TimelineCursorEffect[] = Object.freeze([{ type: "seek.cancel" }])

const APPLY_CANCEL: readonly TimelineCursorEffect[] = Object.freeze([{ type: "apply.cancel" }])

const HISTORY_SEEK: readonly TimelineCursorEffect[] = Object.freeze([{ type: "history.seek" }])

const FOLLOW_END: TimelineCursorEffect = Object.freeze({ type: "follow.end" })

const FOLLOW_DETACH: TimelineCursorEffect = Object.freeze({ type: "follow.detach" })

const HASH_CLEAR: TimelineCursorEffect = Object.freeze({ type: "hash.clear" })

export function createTimelineCursorState(): TimelineCursorState {
  return { status: "applying", initial: true, scheduled: false, attempt: 0 }
}

export function transitionTimelineCursor(
  state: TimelineCursorState,
  event: TimelineCursorEvent,
): TimelineCursorTransition {
  if (event.type === "session.changed") {
    if (state.status === "applying" && state.initial && !state.scheduled) return unchanged(state)

    return changed(
      { status: "applying", initial: true, scheduled: false, attempt: state.attempt + 1 },
      cancelWork(state),
    )
  }

  if (event.type === "disposed") {
    if (state.status === "none") return unchanged(state)

    return changed({ status: "none", attempt: state.attempt + 1 }, cancelWork(state))
  }

  if (event.type === "view.ready") {
    if (state.status === "applying" && !state.scheduled) return apply(state, state.initial, true)

    if (state.status !== "selected" || !state.seek?.paused) return unchanged(state)
    const attempt = state.attempt + 1
    const behavior = state.seek.behavior

    return changed({ ...state, attempt, seek: { behavior, retries: 0 } }, [
      { type: "seek.schedule", attempt, messageID: state.messageID, behavior },
    ])
  }

  if (event.type === "view.unready") {
    if (state.status === "applying" && state.scheduled)
      return changed({ ...state, scheduled: false, attempt: state.attempt + 1 }, APPLY_CANCEL)

    if (state.status !== "selected" || !state.seek || state.seek.paused) return unchanged(state)

    return changed(
      { ...state, attempt: state.attempt + 1, seek: { behavior: state.seek.behavior, retries: 0, paused: true } },
      SEEK_CANCEL,
    )
  }

  if (event.type === "hash.changed") return hashChanged(state, event)

  if (event.type === "hash.applied") return hashApplied(state, event)

  if (event.type === "target.synced") return targetSynced(state, event)

  if (event.type === "message.jump") {
    // Jumping back onto the prompt the route already names writes nothing, so nothing echoes.
    const write = messageIdFromHash(event.hash) !== event.messageID
    const attempt = state.attempt + 1
    const seek = { type: "seek.start", attempt, messageID: event.messageID, behavior: event.behavior } as const

    return changed(
      {
        status: "selected",
        messageID: event.messageID,
        fresh: true,
        attempt,
        seek: event.viewReady
          ? { behavior: event.behavior, retries: 0 }
          : { behavior: event.behavior, retries: 0, paused: true },
        echo: write,
      },
      [
        ...cancelWork(state),
        FOLLOW_DETACH,
        ...(write ? [{ type: "hash.set", messageID: event.messageID } as const] : NO_EFFECTS),
        ...(event.viewReady ? [seek] : NO_EFFECTS),
      ],
    )
  }

  if (event.type === "message.select") {
    // A pinned view shows the newest prompt; a remembered one would only send navigation elsewhere.
    if (!event.messageID || event.following) {
      if (state.status === "applying" || state.status === "none") return unchanged(state)

      return changed({ status: "none", attempt: state.attempt + 1 }, cancelWork(state))
    }

    if (state.status === "selected" && state.messageID === event.messageID && state.fresh && !state.seek)
      return unchanged(state)

    return changed(
      { status: "selected", messageID: event.messageID, fresh: true, attempt: state.attempt + 1 },
      cancelWork(state),
    )
  }

  if (event.type === "scroll.moved") {
    if (state.status !== "selected" || !hasFreshCursorOrSeek(state)) return unchanged(state)

    return changed(
      { status: "selected", messageID: state.messageID, fresh: false, attempt: state.attempt + 1, echo: state.echo },
      cancelWork(state),
    )
  }

  if (event.type === "clear") {
    if (state.status === "none" && !event.hash) return unchanged(state)

    // The router repeats the cleared hash once; ignoring it keeps a smooth return to the end on course.
    if (event.hash)
      return changed({ status: "none", attempt: state.attempt + 1, echo: true }, [...cancelWork(state), HASH_CLEAR])

    return changed({ status: "none", attempt: state.attempt + 1 }, cancelWork(state))
  }

  if (event.type === "latest.advanced") {
    if (state.status !== "selected") return unchanged(state)

    return changed({ status: "none", attempt: state.attempt + 1 }, cancelWork(state))
  }

  if (state.status !== "selected" || !state.seek || state.seek.paused || state.attempt !== event.attempt)
    return unchanged(state)

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

/** A target history pages toward until it loads or can no longer load. */
export function pendingCursorMessageID(state: TimelineCursorState) {
  return state.status === "pending" ? state.messageID : undefined
}

/** Only a fresh cursor or a running seek cares about the reader's scroll, so steady scrolling skips the rest. */
export function hasFreshCursorOrSeek(state: TimelineCursorState) {
  return state.status === "selected" && (state.fresh || (!!state.seek && !state.seek.paused))
}

function hashChanged(
  state: TimelineCursorState,
  event: Extract<TimelineCursorEvent, { type: "hash.changed" }>,
): TimelineCursorTransition {
  const messageID = messageIdFromHash(event.hash)

  // The router's repeat of a hash the cursor wrote or cleared, consumed once: a later link to the same place still
  // navigates.
  if (state.status === "selected" && state.echo && messageID === state.messageID)
    return changed({ ...state, echo: false })

  if (state.status === "none" && state.echo && !event.hash) return changed({ status: "none", attempt: state.attempt })

  if (state.status === "pending" && messageID === state.messageID) return unchanged(state)

  if (state.status === "applying" && !state.scheduled && !event.viewReady) return unchanged(state)

  // A session switch that also changes the hash stays an initial apply.
  return apply(state, state.status === "applying" && state.initial, event.viewReady)
}

function hashApplied(
  state: TimelineCursorState,
  event: Extract<TimelineCursorEvent, { type: "hash.applied" }>,
): TimelineCursorTransition {
  if (state.status !== "applying" || !state.scheduled || state.attempt !== event.attempt) return unchanged(state)
  const attempt = state.attempt + 1
  const messageID = messageIdFromHash(event.hash)

  if (messageID)
    return changed({ status: "pending", messageID, endOnMiss: state.initial && !event.reveal, attempt }, [
      FOLLOW_DETACH,
    ])

  if (event.hash) return changed({ status: "none", attempt }, [{ type: "anchor.scroll", id: event.hash }])

  return changed({ status: "none", attempt }, event.reveal ? NO_EFFECTS : [FOLLOW_END])
}

function targetSynced(
  state: TimelineCursorState,
  event: Extract<TimelineCursorEvent, { type: "target.synced" }>,
): TimelineCursorTransition {
  if (state.status !== "pending" || state.messageID !== event.messageID) return unchanged(state)

  if (event.loaded) {
    // Nothing can mount the prompt's row until the timeline is on screen.
    if (!event.viewReady) return unchanged(state)
    const attempt = state.attempt + 1

    // The route already carries this hash, so nothing echoes.
    return changed(
      { status: "selected", messageID: state.messageID, fresh: true, attempt, seek: { behavior: "auto", retries: 0 } },
      [FOLLOW_DETACH, { type: "seek.schedule", attempt, messageID: state.messageID, behavior: "auto" }],
    )
  }

  // Message IDs ascend and older pages hold only older messages, so a target the revert hides, or one at or after the
  // oldest loaded message, never loads.
  if (event.revertMessageID !== undefined && state.messageID >= event.revertMessageID) return missing(state, event.hash)

  if (event.syncing) return unchanged(state)

  if (event.oldestMessageID !== undefined && state.messageID >= event.oldestMessageID) return missing(state, event.hash)

  if (event.history === "seekable") return changed(state, HISTORY_SEEK)

  if (event.history === "loading") return unchanged(state)

  // A failed page keeps the hash, so a reload tries the target again.
  if (event.history === "failed")
    return changed({ status: "none", attempt: state.attempt + 1 }, state.endOnMiss ? [FOLLOW_END] : NO_EFFECTS)

  return missing(state, event.hash)
}

// A target that cannot load: the hash that still names it is cleared, and the router's repeat ignored once.
function missing(state: Pending, hash: string): TimelineCursorTransition {
  const clear = messageIdFromHash(hash) === state.messageID
  const effects = [...(state.endOnMiss ? [FOLLOW_END] : NO_EFFECTS), ...(clear ? [HASH_CLEAR] : NO_EFFECTS)]

  if (clear) return changed({ status: "none", attempt: state.attempt + 1, echo: true }, effects)

  return changed({ status: "none", attempt: state.attempt + 1 }, effects)
}

function apply(state: TimelineCursorState, initial: boolean, schedule: boolean): TimelineCursorTransition {
  const attempt = state.attempt + 1

  return changed({ status: "applying", initial, scheduled: schedule, attempt }, [
    ...cancelWork(state),
    ...(schedule ? [{ type: "apply.schedule", attempt } as const] : NO_EFFECTS),
  ])
}

function settled(state: Selected): TimelineCursorState {
  return {
    status: "selected",
    messageID: state.messageID,
    fresh: state.fresh,
    attempt: state.attempt,
    echo: state.echo,
  }
}

// Releases the frame the state being left owns.
function cancelWork(state: TimelineCursorState) {
  if (state.status === "applying" && state.scheduled) return APPLY_CANCEL

  if (state.status === "selected" && state.seek && !state.seek.paused) return SEEK_CANCEL

  return NO_EFFECTS
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
