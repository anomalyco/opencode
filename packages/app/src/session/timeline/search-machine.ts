import type { SessionMessageInfo } from "@opencode/client/promise"
import { Timeline } from "@opencode/session-ui/timeline/projection"

// Frames a seek waits for the match's virtualized row and its async Markdown to mount.
export const TIMELINE_SEARCH_SEEK_LIMIT = 12

export type TimelineSearchMatch = {
  readonly revealID: string
  readonly partID: string
  readonly occurrence: number
}

export type SearchablePart = {
  readonly revealID: string
  readonly partID: string
  readonly lower: string
}

type SearchFields = {
  readonly sessionID: string | undefined
  readonly value: string
  readonly query: string
  readonly matches: readonly TimelineSearchMatch[]
  // 0 when there are no matches; otherwise always a valid index into `matches`.
  readonly activeIndex: number
  readonly attempt: number
}

// `attempt` advances each time a seek starts, so a probe result from an earlier seek is ignored.
export type TimelineSearchState =
  | { readonly status: "closed"; readonly attempt: number }
  | (SearchFields & { readonly status: "open" })
  | (SearchFields & { readonly status: "seeking"; readonly retries: number; readonly unfolded: boolean })

export type TimelineSearchEvent =
  | { readonly type: "open"; readonly sessionID: string | undefined }
  | { readonly type: "close" }
  | { readonly type: "query.changed"; readonly value: string; readonly matches: readonly TimelineSearchMatch[] }
  | { readonly type: "move"; readonly delta: number }
  | {
      readonly type: "session.changed"
      readonly sessionID: string | undefined
      readonly matches: readonly TimelineSearchMatch[]
    }
  | {
      readonly type: "matches.synced"
      readonly sessionID: string | undefined
      readonly matches: readonly TimelineSearchMatch[]
    }
  | { readonly type: "seek.missing"; readonly attempt: number }
  | { readonly type: "seek.folded"; readonly attempt: number; readonly foldID: string }
  | { readonly type: "seek.ready"; readonly attempt: number; readonly top: number }
  | { readonly type: "disposed" }

export type TimelineSearchEffect =
  | { readonly type: "focus-input" }
  | { readonly type: "blur-input" }
  | { readonly type: "reveal"; readonly revealID: string; readonly partID: string }
  | {
      readonly type: "seek.schedule"
      readonly attempt: number
      readonly query: string
      readonly partID: string
      readonly occurrence: number
      readonly allowUnfold: boolean
    }
  | { readonly type: "seek.cancel" }
  | { readonly type: "unfold"; readonly foldID: string }
  | { readonly type: "scroll"; readonly top: number }
  | { readonly type: "cancel-frames" }

export type TimelineSearchTransition = {
  readonly state: TimelineSearchState
  readonly effects: readonly TimelineSearchEffect[]
}

export type TimelineSearchView = {
  readonly visible: boolean
  readonly value: string
  readonly query: string
  readonly showCount: boolean
  readonly count: number
  readonly activeDisplay: number
  readonly activePartID: string | undefined
  readonly activeOccurrence: number | undefined
}

type Active = Exclude<TimelineSearchState, { readonly status: "closed" }>

type Seeking = Extract<TimelineSearchState, { readonly status: "seeking" }>

const EMPTY_MATCHES: readonly TimelineSearchMatch[] = Object.freeze([])

const NO_EFFECTS: readonly TimelineSearchEffect[] = Object.freeze([])

const FOCUS_INPUT: readonly TimelineSearchEffect[] = Object.freeze([{ type: "focus-input" }])

const SEEK_CANCEL: readonly TimelineSearchEffect[] = Object.freeze([{ type: "seek.cancel" }])

const CLOSED_VIEW: TimelineSearchView = Object.freeze({
  visible: false,
  value: "",
  query: "",
  showCount: false,
  count: 0,
  activeDisplay: 0,
  activePartID: undefined,
  activeOccurrence: undefined,
})

export function createTimelineSearchState(): TimelineSearchState {
  return { status: "closed", attempt: 0 }
}

export function normalizeSearchQuery(value: string) {
  return value.trim().toLowerCase()
}

export function transitionTimelineSearch(
  state: TimelineSearchState,
  event: TimelineSearchEvent,
): TimelineSearchTransition {
  if (state.status === "closed") {
    if (event.type !== "open") return unchanged(state)

    return changed(
      settled({
        sessionID: event.sessionID,
        value: "",
        query: "",
        matches: EMPTY_MATCHES,
        activeIndex: 0,
        attempt: state.attempt,
      }),
      FOCUS_INPUT,
    )
  }

  // Find is already open: focus and select its text again. A session switch arrives as `session.changed`.
  if (event.type === "open") return changed(state, FOCUS_INPUT)

  if (event.type === "close") {
    return changed({ status: "closed", attempt: state.attempt }, [...cancelSeek(state), { type: "blur-input" }])
  }

  if (event.type === "disposed")
    return changed({ status: "closed", attempt: state.attempt }, [{ type: "cancel-frames" }])

  if (event.type === "query.changed") return queryChanged(state, event.value, event.matches)

  if (event.type === "move") {
    if (event.delta === 0 || state.matches.length === 0) return unchanged(state)

    return seek(state, mod(state.activeIndex + event.delta, state.matches.length))
  }

  if (event.type === "session.changed") {
    if (event.sessionID === state.sessionID) return unchanged(state)

    return changed(
      settled({ ...state, sessionID: event.sessionID, matches: event.matches, activeIndex: 0 }),
      cancelSeek(state),
    )
  }

  if (event.type === "matches.synced") return matchesSynced(state, event.sessionID, event.matches)

  if (state.status !== "seeking" || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "seek.ready") return changed(settled(state), [{ type: "scroll", top: event.top }])

  if (event.type === "seek.folded") {
    // The probe only reports a fold before the first unfold; a fold that stays closed settles instead of looping.
    if (state.unfolded) return changed(settled(state))

    return changed({ ...state, unfolded: true }, [{ type: "unfold", foldID: event.foldID }, schedule(state, false)])
  }

  if (state.retries >= TIMELINE_SEARCH_SEEK_LIMIT) return changed(settled(state))

  return changed({ ...state, retries: state.retries + 1 }, [schedule(state, !state.unfolded)])
}

export function timelineSearchView(state: TimelineSearchState): TimelineSearchView {
  if (state.status === "closed") return CLOSED_VIEW
  const match = state.matches[state.activeIndex]

  return {
    visible: true,
    value: state.value,
    query: state.query,
    showCount: state.value.length > 0,
    count: state.matches.length,
    activeDisplay: match ? state.activeIndex + 1 : 0,
    activePartID: match?.partID,
    activeOccurrence: match?.occurrence,
  }
}

// User and assistant text in timeline order. A match reveals the turn that its user or shell message starts.
export function extractSearchableParts(messages: readonly SessionMessageInfo[]) {
  const parts: SearchablePart[] = []
  let revealID = ""

  for (const message of messages) {
    if (message.type === "user" || message.type === "shell") revealID = message.id

    if (message.type === "user") {
      if (message.text) parts.push({ revealID, partID: `${message.id}:text:0`, lower: message.text.toLowerCase() })

      continue
    }

    if (message.type !== "assistant") continue

    for (const entry of Timeline.contentEntries(message)) {
      if (entry.content.type !== "text" || !entry.content.text) continue
      parts.push({ revealID, partID: entry.id, lower: entry.content.text.toLowerCase() })
    }
  }

  return parts
}

// `query` is already normalized.
export function findMatchesInParts(parts: readonly SearchablePart[], query: string) {
  if (!query) return EMPTY_MATCHES

  return parts.flatMap((part) => {
    const found: TimelineSearchMatch[] = []

    for (let at = part.lower.indexOf(query); at !== -1; at = part.lower.indexOf(query, at + query.length)) {
      found.push({ revealID: part.revealID, partID: part.partID, occurrence: found.length })
    }

    return found
  })
}

function queryChanged(state: Active, value: string, matches: readonly TimelineSearchMatch[]): TimelineSearchTransition {
  if (value === state.value) return unchanged(state)
  const query = normalizeSearchQuery(value)

  // Whitespace or casing does not change the results, so the current match and any seek stay.
  if (query === state.query) return changed({ ...state, value })

  if (matches.length === 0) {
    return changed(settled({ ...state, value, query, matches: EMPTY_MATCHES, activeIndex: 0 }), cancelSeek(state))
  }

  return seek({ ...state, value, query, matches }, 0)
}

// Keeps the active match by identity, so a list that shrinks and grows again never resurrects an old index.
function matchesSynced(
  state: Active,
  sessionID: string | undefined,
  matches: readonly TimelineSearchMatch[],
): TimelineSearchTransition {
  if (sessionID !== state.sessionID || !state.query || sameMatches(state.matches, matches)) return unchanged(state)
  const active = state.matches[state.activeIndex]
  const kept = active ? matches.findIndex((match) => sameMatch(match, active)) : -1

  if (state.status === "seeking" && kept >= 0) return changed({ ...state, matches, activeIndex: kept })

  return changed(settled({ ...state, matches, activeIndex: Math.max(kept, 0) }), cancelSeek(state))
}

function seek(fields: SearchFields, activeIndex: number): TimelineSearchTransition {
  const match = fields.matches[activeIndex]

  const next: Seeking = {
    status: "seeking",
    sessionID: fields.sessionID,
    value: fields.value,
    query: fields.query,
    matches: fields.matches,
    activeIndex,
    attempt: fields.attempt + 1,
    retries: 0,
    unfolded: false,
  }

  return changed(next, [{ type: "reveal", revealID: match.revealID, partID: match.partID }, schedule(next, true)])
}

function schedule(state: Seeking, allowUnfold: boolean): TimelineSearchEffect {
  const match = state.matches[state.activeIndex]

  return {
    type: "seek.schedule",
    attempt: state.attempt,
    query: state.query,
    partID: match.partID,
    occurrence: match.occurrence,
    allowUnfold,
  }
}

// Copies only the shared fields, so no seek bookkeeping leaks into the settled state.
function settled(fields: SearchFields): TimelineSearchState {
  return {
    status: "open",
    sessionID: fields.sessionID,
    value: fields.value,
    query: fields.query,
    matches: fields.matches,
    activeIndex: fields.activeIndex,
    attempt: fields.attempt,
  }
}

function cancelSeek(state: Active) {
  return state.status === "seeking" ? SEEK_CANCEL : NO_EFFECTS
}

function sameMatch(left: TimelineSearchMatch, right: TimelineSearchMatch) {
  return left.partID === right.partID && left.occurrence === right.occurrence
}

function sameMatches(left: readonly TimelineSearchMatch[], right: readonly TimelineSearchMatch[]) {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((match, index) => sameMatch(match, right[index]) && match.revealID === right[index].revealID))
  )
}

function mod(value: number, size: number) {
  return ((value % size) + size) % size
}

function changed(
  state: TimelineSearchState,
  effects: readonly TimelineSearchEffect[] = NO_EFFECTS,
): TimelineSearchTransition {
  return { state, effects }
}

function unchanged(state: TimelineSearchState): TimelineSearchTransition {
  return { state, effects: NO_EFFECTS }
}
