// A detached reader within this distance of the top loads the next older page, and the one after it while they stay
// there.
export const HISTORY_SCROLL_THRESHOLD = 200

// The least loaded history, in pixels, that a reader who scrolls toward the top keeps above the view. A wheel covers
// about this much while a page is on its way, and it is no slower in a short window.
export const HISTORY_RUNWAY_MIN = 2400

// The same in screens, for page keys, which move a screen at a time.
export const HISTORY_RUNWAY_SCREENS = 2

// The messages in an older page.
export const HISTORY_PAGE_MESSAGES = 20

// The most messages in a page for a reader the pages do not keep up with. A page this size lands in about the frame
// time of a 20-message page at the same depth; twice as many take 1.5 to 2 times as long.
export const HISTORY_PAGE_MESSAGES_MAX = 80

// A page that never settles fails, so paging cannot stay "loading" forever.
export const HISTORY_LOAD_TIMEOUT_MS = 30_000

// After a failed page, scrolling near the top waits this long before it retries.
export const HISTORY_RETRY_COOLDOWN_MS = 2_000

export type HistoryTarget = {
  readonly sessionKey: string
  readonly sessionID: string
}

/**
 * A layout check queued for the next frame. `fill`: a following view whose content does not overflow loads more.
 * `top`: a detached view still near the top after a prepend loads more. `runway`: so does one with less than the
 * runway above it, whose reader kept scrolling toward the top while the page loaded.
 */
export type HistoryProbe = "fill" | "top" | "runway"

// `attempt` advances on every change of phase, so a probe, page or cooldown result from an earlier one is ignored.
export type TimelineHistoryState =
  /** No session, or its first messages are not loaded yet. */
  | { readonly status: "inactive"; readonly attempt: number }
  | {
      readonly status: "idle"
      readonly target: HistoryTarget
      readonly attempt: number
      readonly probe?: HistoryProbe
      /** The messages in the page that just landed, while its probe is pending. */
      readonly messages?: number
    }
  | {
      readonly status: "loading"
      readonly target: HistoryTarget
      readonly attempt: number
      /** The reader scrolled toward the top while this page loaded, so the next one follows without another scroll. */
      readonly advanced: boolean
      /** The messages this page asks for. */
      readonly messages: number
    }
  /**
   * The last page failed. Once `coolingDown` ends, the reader's own scroll retries it, and a following view checks its
   * fill once; a hash target does not, so a detached view does not poll a broken server.
   */
  | {
      readonly status: "failed"
      readonly target: HistoryTarget
      readonly attempt: number
      readonly coolingDown: boolean
    }
  /**
   * `stalled`: the store still has a cursor, but the last page added nothing, so paging stops instead of looping. It
   * holds the oldest loaded message then; a resync or reload that replaces the transcript changes it and starts again.
   */
  | {
      readonly status: "exhausted"
      readonly target: HistoryTarget
      readonly attempt: number
      readonly stalled?: { readonly oldest: string | undefined }
    }

export type TimelineHistoryEvent =
  | {
      readonly type: "sync"
      readonly target: HistoryTarget | undefined
      readonly ready: boolean
      readonly more: boolean
      readonly following: boolean
      /** The oldest loaded message. */
      readonly oldest: string | undefined
    }
  /**
   * A detached reader scrolled at the top, or toward it with less than the runway above the view. Upward input at
   * the top counts too: it cannot scroll, so no scroll reports it.
   */
  | { readonly type: "scroll.top" }
  /** The content or the view changed size while following. */
  | { readonly type: "fill.requested" }
  /** A hash or pending message target is not loaded yet. */
  | { readonly type: "seek.requested" }
  | { readonly type: "probe.settled"; readonly attempt: number; readonly load: boolean }
  /** A page made progress when the oldest loaded message changed: an older page landed, or the transcript resynced. */
  | {
      readonly type: "page.loaded"
      readonly attempt: number
      readonly previous: string | undefined
      readonly oldest: string | undefined
      readonly more: boolean
      readonly following: boolean
    }
  | { readonly type: "page.failed"; readonly attempt: number }
  | { readonly type: "page.timed-out"; readonly attempt: number }
  | { readonly type: "cooldown.settled"; readonly attempt: number; readonly following: boolean }
  | { readonly type: "disposed" }

export type TimelineHistoryEffect =
  | { readonly type: "probe.schedule"; readonly probe: HistoryProbe; readonly attempt: number }
  | { readonly type: "probe.cancel" }
  | { readonly type: "load.start"; readonly sessionID: string; readonly attempt: number; readonly messages: number }
  | { readonly type: "load.abort" }
  | { readonly type: "cooldown.start"; readonly attempt: number }
  | { readonly type: "cooldown.cancel" }

export type TimelineHistoryTransition = {
  readonly state: TimelineHistoryState
  readonly effects: readonly TimelineHistoryEffect[]
}

type Active = Exclude<TimelineHistoryState, { readonly status: "inactive" }>

// Shared events for the frequent dispatches, so scrolling and resizing allocate nothing.
export const SCROLL_TOP_EVENT: TimelineHistoryEvent = Object.freeze({ type: "scroll.top" })

export const FILL_REQUESTED_EVENT: TimelineHistoryEvent = Object.freeze({ type: "fill.requested" })

export const SEEK_REQUESTED_EVENT: TimelineHistoryEvent = Object.freeze({ type: "seek.requested" })

export const DISPOSED_HISTORY_EVENT: TimelineHistoryEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly TimelineHistoryEffect[] = Object.freeze([])

const PROBE_CANCEL: readonly TimelineHistoryEffect[] = Object.freeze([{ type: "probe.cancel" }])

const LOAD_ABORT: readonly TimelineHistoryEffect[] = Object.freeze([{ type: "load.abort" }])

const COOLDOWN_CANCEL: readonly TimelineHistoryEffect[] = Object.freeze([{ type: "cooldown.cancel" }])

export function createTimelineHistoryState(): TimelineHistoryState {
  return { status: "inactive", attempt: 0 }
}

export function transitionTimelineHistory(
  state: TimelineHistoryState,
  event: TimelineHistoryEvent,
): TimelineHistoryTransition {
  if (event.type === "disposed") return deactivate(state)

  if (event.type === "sync") return synced(state, event)

  if (state.status === "inactive") return unchanged(state)

  if (event.type === "scroll.top") {
    if (!canRequestScrollPage(state)) return unchanged(state)

    if (state.status === "loading") return changed({ ...state, advanced: true })

    // A scroll in the frame a page landed, before its probe ran: the page left the reader short, as below.
    return load(state, state.status === "idle" && state.probe && state.probe !== "fill" ? grown(state.messages) : undefined)
  }

  if (event.type === "seek.requested") return canSeekHistory(state) ? load(state) : unchanged(state)

  if (event.type === "fill.requested")
    return canRequestFillProbe(state) ? probe(state.target, state.attempt + 1, "fill", cancel(state)) : unchanged(state)

  if (event.type === "probe.settled") {
    if (state.status !== "idle" || !state.probe || state.attempt !== event.attempt) return unchanged(state)

    // The page that landed left the reader short of the runway, or at the top: the next one is twice the size, so
    // a reader who outruns the pages does not catch them up. A view that fills keeps the page size: it must not
    // load more than the fill takes. The probe already ran, so there is nothing to cancel.
    if (event.load) return load(state, state.probe === "fill" ? undefined : grown(state.messages), NO_EFFECTS)

    return changed({ status: "idle", target: state.target, attempt: state.attempt })
  }

  if (event.type === "cooldown.settled") {
    if (state.status !== "failed" || !state.coolingDown || state.attempt !== event.attempt) return unchanged(state)

    // A short, following view cannot scroll to retry, so it checks the fill once per cooldown.
    if (event.following) return probe(state.target, state.attempt + 1, "fill", NO_EFFECTS)

    return changed({ ...state, coolingDown: false })
  }

  if (state.status !== "loading" || state.attempt !== event.attempt) return unchanged(state)
  const attempt = state.attempt + 1

  if (event.type === "page.loaded") {
    if (!event.more) return changed({ status: "exhausted", target: state.target, attempt })

    if (event.oldest === event.previous)
      return changed({ status: "exhausted", target: state.target, attempt, stalled: { oldest: event.oldest } })

    return probe(
      state.target,
      attempt,
      event.following ? "fill" : state.advanced ? "runway" : "top",
      NO_EFFECTS,
      state.messages,
    )
  }

  return changed({ status: "failed", target: state.target, attempt, coolingDown: true }, [
    ...(event.type === "page.timed-out" ? LOAD_ABORT : NO_EFFECTS),
    { type: "cooldown.start", attempt },
  ])
}

/** The loaded history a reader who scrolls toward the top keeps above a view `viewportHeight` tall. */
export function historyRunway(viewportHeight: number) {
  return Math.max(HISTORY_RUNWAY_MIN, viewportHeight * HISTORY_RUNWAY_SCREENS)
}

/**
 * Whether a detached reader's scroll asks for the next older page: any scroll at the top, and one toward the top with
 * less than the runway above the view, so the page lands before the reader gets there. Inside the runway only a
 * scroll toward the top counts. A page that lands pushes the offset the other way, and rows can be far shorter than
 * the messages they hold, so paging until the runway is full could load a whole session unasked.
 */
export function scrollLoadsHistory(top: number, previousTop: number, viewportHeight: number) {
  return top < HISTORY_SCROLL_THRESHOLD || (top < previousTop && top < historyRunway(viewportHeight))
}

/** A scroll that asks for a page may request it, or tell a page that is loading that the reader is still coming. */
export function canRequestScrollPage(state: TimelineHistoryState) {
  return (
    state.status === "idle" ||
    (state.status === "failed" && !state.coolingDown) ||
    (state.status === "loading" && !state.advanced)
  )
}

/** A following view may check whether its content still leaves room for older messages. */
export function canRequestFillProbe(state: TimelineHistoryState) {
  return (state.status === "idle" && state.probe !== "fill") || (state.status === "failed" && !state.coolingDown)
}

/** A target that is not loaded yet may page through history only while nothing failed, ran out or is loading. */
export function canSeekHistory(state: TimelineHistoryState) {
  return state.status === "idle"
}

export type HistorySeekStatus = "loading" | "seekable" | "exhausted" | "failed"

/** How paging toward a target that is not loaded yet stands: it can start, is under way, ran out or failed. */
export function historySeekStatus(state: TimelineHistoryState): HistorySeekStatus {
  if (state.status === "idle") return "seekable"

  if (state.status === "inactive" || state.status === "loading") return "loading"

  return state.status
}

function synced(
  state: TimelineHistoryState,
  event: Extract<TimelineHistoryEvent, { type: "sync" }>,
): TimelineHistoryTransition {
  if (!event.target || !event.ready) return deactivate(state)

  if (state.status === "inactive" || !sameTarget(state.target, event.target))
    return enter(event.target, state.attempt + 1, event, cancel(state))

  // The store publishes the page, and its cursor, before the request settles; `page.loaded` reads both.
  if (state.status === "loading") return unchanged(state)

  if (state.status === "exhausted") {
    if (!event.more)
      return state.stalled
        ? changed({ status: "exhausted", target: state.target, attempt: state.attempt })
        : unchanged(state)

    // A reloaded or resynced transcript has a cursor again, or a different oldest message than the stalled page left.
    if (!state.stalled || state.stalled.oldest !== event.oldest)
      return enter(state.target, state.attempt + 1, event, NO_EFFECTS)

    return unchanged(state)
  }

  if (!event.more)
    return changed({ status: "exhausted", target: state.target, attempt: state.attempt + 1 }, cancel(state))

  if (state.status === "failed" || !event.following || state.probe === "fill") return unchanged(state)

  return probe(state.target, state.attempt + 1, "fill", cancel(state))
}

function enter(
  target: HistoryTarget,
  attempt: number,
  event: Extract<TimelineHistoryEvent, { type: "sync" }>,
  effects: readonly TimelineHistoryEffect[],
): TimelineHistoryTransition {
  if (!event.more) return changed({ status: "exhausted", target, attempt }, effects)

  if (event.following) return probe(target, attempt, "fill", effects)

  return changed({ status: "idle", target, attempt }, effects)
}

function load(
  state: Active,
  messages = HISTORY_PAGE_MESSAGES,
  released = cancel(state),
): TimelineHistoryTransition {
  const attempt = state.attempt + 1

  return changed({ status: "loading", target: state.target, attempt, advanced: false, messages }, [
    ...released,
    { type: "load.start", sessionID: state.target.sessionID, attempt, messages },
  ])
}

// The size of the page after one of `messages` that did not cover the reader's distance.
function grown(messages = HISTORY_PAGE_MESSAGES) {
  return Math.min(HISTORY_PAGE_MESSAGES_MAX, messages * 2)
}

function probe(
  target: HistoryTarget,
  attempt: number,
  kind: HistoryProbe,
  effects: readonly TimelineHistoryEffect[],
  messages?: number,
): TimelineHistoryTransition {
  return changed({ status: "idle", target, attempt, probe: kind, ...(messages === undefined ? {} : { messages }) }, [
    ...effects,
    { type: "probe.schedule", probe: kind, attempt },
  ])
}

function deactivate(state: TimelineHistoryState): TimelineHistoryTransition {
  if (state.status === "inactive") return unchanged(state)

  return changed({ status: "inactive", attempt: state.attempt + 1 }, cancel(state))
}

// Releases the work the state being left owns.
function cancel(state: TimelineHistoryState) {
  if (state.status === "idle" && state.probe) return PROBE_CANCEL

  if (state.status === "loading") return LOAD_ABORT

  if (state.status === "failed" && state.coolingDown) return COOLDOWN_CANCEL

  return NO_EFFECTS
}

function sameTarget(left: HistoryTarget, right: HistoryTarget) {
  return left.sessionKey === right.sessionKey && left.sessionID === right.sessionID
}

function changed(
  state: TimelineHistoryState,
  effects: readonly TimelineHistoryEffect[] = NO_EFFECTS,
): TimelineHistoryTransition {
  return { state, effects }
}

function unchanged(state: TimelineHistoryState): TimelineHistoryTransition {
  return { state, effects: NO_EFFECTS }
}
