import type { SessionMessageInfo } from "@opencode/client/promise"
import { Timeline } from "@opencode/session-ui/timeline/projection"

// Frames a seek lasts. It waits for the match's virtualized row and its async Markdown to mount, scrolls to the match
// once it rests, and keeps it there while the rows above it render.
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
  | (SearchFields & {
      readonly status: "seeking"
      readonly retries: number
      readonly unfolded: boolean
      /** The scroll offset that centres the match where the last probe found it. */
      readonly top: number | undefined
      /** The offset Find scrolled to. */
      readonly landed: number | undefined
    })

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
  /** A probe did not find the match. `at` is the timeline's scroll offset, when the timeline is mounted. */
  | { readonly type: "seek.missing"; readonly attempt: number; readonly at: number | undefined }
  | { readonly type: "seek.folded"; readonly attempt: number; readonly foldID: string }
  /** A probe found the match. `top` is the scroll offset that centres it, `at` the offset the timeline is at. */
  | { readonly type: "seek.ready"; readonly attempt: number; readonly top: number; readonly at: number }
  /** The reader scrolled the timeline. */
  | { readonly type: "reader.scrolled" }
  | { readonly type: "disposed" }

export type TimelineSearchEffect =
  | { readonly type: "focus-input" }
  | { readonly type: "blur-input" }
  | { readonly type: "reveal"; readonly revealID: string; readonly partID: string }
  /** End the timeline's own scroll to the match's row. */
  | { readonly type: "reveal.stop" }
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

const READER_SCROLLED: readonly TimelineSearchEffect[] = Object.freeze([
  { type: "seek.cancel" },
  { type: "reveal.stop" },
])

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

  // The view is the reader's from here: the seek ends, and so does the reveal it started, which the timeline would
  // otherwise go on writing. The match, its highlight and the count stay.
  if (event.type === "reader.scrolled")
    return state.status === "seeking" ? changed(settled(state), READER_SCROLLED) : unchanged(state)

  if (state.status !== "seeking" || event.attempt !== state.attempt) return unchanged(state)

  // Not every scroll of the reader's tells Find: Ctrl+Home, a page key on a control in a row and the scrollbar send
  // no input event. So once Find has scrolled, the view is Find's only while it is where Find put it, or where a
  // size correction took it together with the match. Anywhere else, the reader moved it, and the seek ends: Find
  // neither scrolls again nor brings the match's row back. That took the view back from a reader who pressed End.
  if (state.landed !== undefined && event.type !== "seek.folded" && left(state.landed, event))
    return changed(settled(state))

  if (event.type === "seek.ready") {
    // The timeline is still bringing the match's row in while the rows around it measure, and it undoes a scroll made
    // before it is done. So Find scrolls once the match rests: two probes a frame apart find it in the same place.
    // The seek then goes on to its last frame, because a row above the match can render later and move it, and Find
    // scrolls again when the match rests in a new place. A match that never rests is scrolled to on the last frame.
    const last = state.retries >= TIMELINE_SEARCH_SEEK_LIMIT
    const rests = state.top !== undefined && Math.abs(state.top - event.top) < 1
    const landed = state.landed !== undefined && Math.abs(state.landed - event.top) < 1
    const scroll: TimelineSearchEffect[] = !landed && (rests || last) ? [{ type: "scroll", top: event.top }] : []

    if (last) return changed(settled(state), scroll)

    return changed(
      { ...state, retries: state.retries + 1, top: event.top, landed: scroll.length ? event.top : state.landed },
      [...scroll, schedule(state, !state.unfolded)],
    )
  }

  if (event.type === "seek.folded") {
    // The probe only reports a fold before the first unfold; a fold that stays closed settles instead of looping.
    if (state.unfolded) return changed(settled(state))

    return changed({ ...state, unfolded: true }, [{ type: "unfold", foldID: event.foldID }, schedule(state, false)])
  }

  if (state.retries >= TIMELINE_SEARCH_SEEK_LIMIT) return changed(settled(state))
  const retry = { ...state, retries: state.retries + 1 }

  if (state.top === undefined) return changed(retry, [schedule(state, !state.unfolded)])

  // The match rendered and is gone: a row above it rendered late and pushed its row out of the mounted rows. Find
  // brings the row back and starts over with the frames that are left.
  return changed({ ...retry, top: undefined, landed: undefined }, [
    reveal(state.matches[state.activeIndex]),
    schedule(state, !state.unfolded),
  ])
}

// Whether the view is neither where Find scrolled it to nor where the match is now.
function left(
  landed: number,
  event: Extract<TimelineSearchEvent, { readonly type: "seek.ready" | "seek.missing" }>,
) {
  if (event.at === undefined || Math.abs(event.at - landed) < 1) return false

  return event.type === "seek.missing" || Math.abs(event.at - event.top) >= 1
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

/** Whether two views show the same. A seek's probes change the state on every frame and the view on none of them. */
export function sameTimelineSearchView(a: TimelineSearchView, b: TimelineSearchView) {
  return (
    a.visible === b.visible &&
    a.value === b.value &&
    a.query === b.query &&
    a.showCount === b.showCount &&
    a.count === b.count &&
    a.activeDisplay === b.activeDisplay &&
    a.activePartID === b.activePartID &&
    a.activeOccurrence === b.activeOccurrence
  )
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
    top: undefined,
    landed: undefined,
  }

  return changed(next, [reveal(match), schedule(next, true)])
}

function reveal(match: TimelineSearchMatch): TimelineSearchEffect {
  return { type: "reveal", revealID: match.revealID, partID: match.partID }
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
