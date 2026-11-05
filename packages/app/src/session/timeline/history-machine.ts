// A detached reader within this distance of the top loads the next older page.
export const HISTORY_SCROLL_THRESHOLD = 200

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
 * `top`: a detached view still near the top after a prepend loads more.
 */
export type HistoryProbe = "fill" | "top"

// `attempt` advances on every change of phase, so a probe, page or cooldown result from an earlier one is ignored.
export type TimelineHistoryState =
  /** No session, or its first messages are not loaded yet. */
  | { readonly status: "inactive"; readonly attempt: number }
  | {
      readonly status: "idle"
      readonly target: HistoryTarget
      readonly attempt: number
      readonly probe?: HistoryProbe
    }
  | { readonly status: "loading"; readonly target: HistoryTarget; readonly attempt: number }
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
  /** A detached reader scrolled near the top. */
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
  | { readonly type: "load.start"; readonly sessionID: string; readonly attempt: number }
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

  if (event.type === "scroll.top") return canRequestScrollPage(state) ? load(state) : unchanged(state)

  if (event.type === "seek.requested") return canSeekHistory(state) ? load(state) : unchanged(state)

  if (event.type === "fill.requested")
    return canRequestFillProbe(state) ? probe(state.target, state.attempt + 1, "fill", cancel(state)) : unchanged(state)

  if (event.type === "probe.settled") {
    if (state.status !== "idle" || !state.probe || state.attempt !== event.attempt) return unchanged(state)

    // The probe already ran, so there is nothing to cancel.
    if (event.load) return load(state, NO_EFFECTS)

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

    return probe(state.target, attempt, event.following ? "fill" : "top", NO_EFFECTS)
  }

  return changed({ status: "failed", target: state.target, attempt, coolingDown: true }, [
    ...(event.type === "page.timed-out" ? LOAD_ABORT : NO_EFFECTS),
    { type: "cooldown.start", attempt },
  ])
}

/** A detached reader near the top may request the next page. */
export function canRequestScrollPage(state: TimelineHistoryState) {
  return state.status === "idle" || (state.status === "failed" && !state.coolingDown)
}

/** A following view may check whether its content still leaves room for older messages. */
export function canRequestFillProbe(state: TimelineHistoryState) {
  return (state.status === "idle" && state.probe !== "fill") || (state.status === "failed" && !state.coolingDown)
}

/** A target that is not loaded yet may page through history only while nothing failed, ran out or is loading. */
export function canSeekHistory(state: TimelineHistoryState) {
  return state.status === "idle"
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

function load(state: Active, released = cancel(state)): TimelineHistoryTransition {
  const attempt = state.attempt + 1

  return changed({ status: "loading", target: state.target, attempt }, [
    ...released,
    { type: "load.start", sessionID: state.target.sessionID, attempt },
  ])
}

function probe(
  target: HistoryTarget,
  attempt: number,
  kind: HistoryProbe,
  effects: readonly TimelineHistoryEffect[],
): TimelineHistoryTransition {
  return changed({ status: "idle", target, attempt, probe: kind }, [
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
