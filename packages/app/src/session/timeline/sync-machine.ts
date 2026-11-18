import type { SessionMessageInfo } from "@opencode/client/promise"

// A first sync that never settles reveals the timeline instead of hiding it forever.
export const TIMELINE_SYNC_TIMEOUT_MS = 30_000

export const LEADING_TURN_PAGE_DELAY_MS = 200

export const LEADING_TURN_PAGE_LIMIT = 3

// Pauses spent waiting for another history load, so a page that hangs elsewhere cannot keep enrichment polling.
export const LEADING_TURN_BUSY_LIMIT = 15

export const LEADING_TURN_LOAD_TIMEOUT_MS = 30_000

export type TimelineSyncTarget = {
  readonly sessionKey: string
  readonly sessionID: string
}

/**
 * The first sync of a session's newest messages, then the background pages that complete a leading turn the newest
 * page cut mid-turn. `attempt` advances on every change of phase, so a sync, pause or page from an earlier one is
 * ignored.
 */
export type TimelineSyncState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "syncing"; readonly target: TimelineSyncTarget; readonly attempt: number }
  | {
      readonly status: "enriching"
      readonly target: TimelineSyncTarget
      readonly attempt: number
      readonly assistantID: string
      readonly step: "pausing" | "loading"
      readonly pages: number
      readonly waits: number
    }
  | { readonly status: "ready"; readonly target: TimelineSyncTarget; readonly attempt: number }
  | { readonly status: "failed"; readonly target: TimelineSyncTarget; readonly attempt: number; readonly error: object }

export type TimelineSyncEvent =
  | { readonly type: "target.changed"; readonly target: TimelineSyncTarget | undefined }
  | {
      readonly type: "sync.succeeded"
      readonly attempt: number
      /** The leading assistant message first seen in this transcript. */
      readonly assistantID: string | undefined
      readonly needsParent: boolean
      readonly more: boolean
    }
  | { readonly type: "sync.failed"; readonly attempt: number; readonly error: object }
  | { readonly type: "sync.timed-out"; readonly attempt: number }
  | {
      readonly type: "enrich.paused"
      readonly attempt: number
      readonly needsParent: boolean
      readonly more: boolean
      /** Another history load is in flight. */
      readonly loading: boolean
    }
  | {
      readonly type: "enrich.page-settled"
      readonly attempt: number
      readonly succeeded: boolean
      readonly needsParent: boolean
      readonly more: boolean
    }
  | { readonly type: "disposed" }

export type TimelineSyncEffect =
  | { readonly type: "sync.start"; readonly target: TimelineSyncTarget; readonly attempt: number }
  | { readonly type: "sync.cancel" }
  | {
      readonly type: "pause.start"
      readonly sessionID: string
      readonly assistantID: string
      readonly attempt: number
    }
  | { readonly type: "pause.cancel" }
  | {
      readonly type: "page.load"
      readonly sessionID: string
      readonly assistantID: string
      readonly attempt: number
    }
  | { readonly type: "page.abort" }

export type TimelineSyncTransition = {
  readonly state: TimelineSyncState
  readonly effects: readonly TimelineSyncEffect[]
}

export const DISPOSED_TIMELINE_SYNC_EVENT: TimelineSyncEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly TimelineSyncEffect[] = Object.freeze([])

const SYNC_CANCEL: readonly TimelineSyncEffect[] = Object.freeze([{ type: "sync.cancel" }])

const PAUSE_CANCEL: readonly TimelineSyncEffect[] = Object.freeze([{ type: "pause.cancel" }])

const PAGE_ABORT: readonly TimelineSyncEffect[] = Object.freeze([{ type: "page.abort" }])

export function createTimelineSyncState(): TimelineSyncState {
  return { status: "idle", attempt: 0 }
}

export function transitionTimelineSync(state: TimelineSyncState, event: TimelineSyncEvent): TimelineSyncTransition {
  if (event.type === "disposed") return stop(state)

  if (event.type === "target.changed") {
    const target = event.target

    // A new-session draft has no session to sync.
    if (!target) return stop(state)

    if (state.status !== "idle" && sameTarget(state.target, target)) return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: { status: "syncing", target, attempt },
      effects: [...cancel(state), { type: "sync.start", target, attempt }],
    }
  }

  if (state.status === "idle" || state.attempt !== event.attempt) return unchanged(state)
  const attempt = state.attempt + 1

  if (state.status === "syncing") {
    if (event.type === "sync.failed")
      return {
        state: { status: "failed", target: state.target, attempt, error: event.error },
        effects: NO_EFFECTS,
      }

    if (event.type === "sync.timed-out") return ready(state.target, attempt, SYNC_CANCEL)

    if (event.type !== "sync.succeeded") return unchanged(state)

    if (!event.assistantID || !event.needsParent || !event.more) return ready(state.target, attempt)

    return pause({
      status: "enriching",
      target: state.target,
      attempt,
      assistantID: event.assistantID,
      step: "pausing",
      pages: 0,
      waits: 0,
    })
  }

  if (state.status !== "enriching") return unchanged(state)

  if (event.type === "enrich.paused" && state.step === "pausing") {
    if (!event.needsParent || !event.more) return ready(state.target, attempt)

    if (event.loading)
      return state.waits + 1 >= LEADING_TURN_BUSY_LIMIT
        ? ready(state.target, attempt)
        : pause({ ...state, attempt, waits: state.waits + 1 })

    return {
      state: { ...state, attempt, step: "loading", waits: 0 },
      effects: [{ type: "page.load", sessionID: state.target.sessionID, assistantID: state.assistantID, attempt }],
    }
  }

  if (event.type === "enrich.page-settled" && state.step === "loading") {
    // A failed page leaves the leading turn as it is; a later visit to the session resumes it.
    if (!event.succeeded || state.pages + 1 >= LEADING_TURN_PAGE_LIMIT || !event.needsParent || !event.more)
      return ready(state.target, attempt)

    return pause({ ...state, attempt, step: "pausing", pages: state.pages + 1, waits: 0 })
  }

  return unchanged(state)
}

/** Whether the newest page of `target` is still loading. Background enrichment does not count. */
export function isTimelineSyncing(state: TimelineSyncState, target: TimelineSyncTarget | undefined) {
  if (!target) return false

  return state.status === "idle" || state.status === "syncing" || !sameTarget(state.target, target)
}

export function timelineSyncError(state: TimelineSyncState, target: TimelineSyncTarget | undefined) {
  if (!target || state.status !== "failed" || !sameTarget(state.target, target)) return undefined

  return state.error
}

/** Whether the timeline can show. A loaded tail shows at once; enrichment never withholds it. */
export function isTimelineReady(
  state: TimelineSyncState,
  target: TimelineSyncTarget | undefined,
  hasTail: () => boolean,
) {
  if (!target) return true

  if ((state.status === "enriching" || state.status === "ready") && sameTarget(state.target, target)) return true

  return hasTail()
}

export function sameTarget(a: TimelineSyncTarget | undefined, b: TimelineSyncTarget | undefined) {
  return a?.sessionKey === b?.sessionKey && a?.sessionID === b?.sessionID
}

/**
 * The leading assistant message to complete, remembered per transcript. The store keeps the transcript array across
 * prepends and tab switches and replaces it on eviction, so an interrupted enrichment resumes the turn that was
 * visible on entry rather than one that older pages prepended since.
 */
export function resolveLeadingAssistant(memo: WeakMap<SessionMessageInfo[], string>, messages: SessionMessageInfo[]) {
  const assistant = memo.get(messages) ?? messages.find((message) => message.type === "assistant")?.id

  if (assistant) memo.set(messages, assistant)

  return assistant
}

export function leadingTurnNeedsParent(messages: SessionMessageInfo[], id: string) {
  // Older pages can start mid-turn too; only complete the turn that was visible on entry.
  const assistant = messages.findIndex((message) => message.id === id)

  if (assistant === -1) return false
  const boundary = messages.findIndex((message) => message.type === "user" || message.type === "shell")

  return boundary === -1 || assistant < boundary
}

function stop(state: TimelineSyncState): TimelineSyncTransition {
  if (state.status === "idle") return unchanged(state)

  return { state: { status: "idle", attempt: state.attempt + 1 }, effects: cancel(state) }
}

function ready(target: TimelineSyncTarget, attempt: number, effects = NO_EFFECTS): TimelineSyncTransition {
  return { state: { status: "ready", target, attempt }, effects }
}

function pause(state: Extract<TimelineSyncState, { status: "enriching" }>): TimelineSyncTransition {
  return {
    state,
    effects: [
      {
        type: "pause.start",
        sessionID: state.target.sessionID,
        assistantID: state.assistantID,
        attempt: state.attempt,
      },
    ],
  }
}

function cancel(state: TimelineSyncState) {
  if (state.status === "syncing") return SYNC_CANCEL

  if (state.status !== "enriching") return NO_EFFECTS

  return state.step === "pausing" ? PAUSE_CANCEL : PAGE_ABORT
}

function unchanged(state: TimelineSyncState): TimelineSyncTransition {
  return { state, effects: NO_EFFECTS }
}
