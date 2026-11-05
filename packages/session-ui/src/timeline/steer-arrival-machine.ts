import { Predicate } from "effect"
import type { TimelineRow } from "./timeline-row"

/**
 * Which user messages grow in as they render. `seen` holds the message IDs of the session's rows so far: user messages,
 * shells and assistant messages. A user message counts as a steer only when it lands below a seen row while the session
 * works, so the first page and history loaded above it appear as they are. `arriving` holds steers whose rows have not
 * rendered yet; rendering one, or the session going idle, removes it.
 */
export type SteerArrivalState =
  | {
      readonly status: "tracking"
      readonly sessionID: string
      readonly seen: ReadonlySet<string>
      readonly arriving: ReadonlySet<string>
    }
  | { readonly status: "disposed" }

export type SteerArrivalEvent =
  | {
      readonly type: "sync"
      readonly sessionID: string
      readonly rows: readonly TimelineRow.TimelineRow[]
      readonly busy: boolean
    }
  | { readonly type: "rendered"; readonly messageID: string }
  | { readonly type: "disposed" }

const EMPTY: ReadonlySet<string> = new Set()

export const INITIAL_STEER_ARRIVAL_STATE: SteerArrivalState = Object.freeze({
  status: "tracking",
  sessionID: "",
  seen: EMPTY,
  arriving: EMPTY,
})

export const DISPOSED_STEER_ARRIVAL_STATE: SteerArrivalState = Object.freeze({ status: "disposed" })

export const DISPOSED_STEER_ARRIVAL_EVENT: SteerArrivalEvent = Object.freeze({ type: "disposed" })

// Row projections run on every streamed change, so a sync that adds no row and keeps the steers returns the same state.
export function transitionSteerArrival(state: SteerArrivalState, event: SteerArrivalEvent): SteerArrivalState {
  if (state.status === "disposed") return state

  if (event.type === "disposed") return DISPOSED_STEER_ARRIVAL_STATE

  if (event.type === "rendered") {
    if (!state.arriving.has(event.messageID)) return state
    const arriving = new Set(state.arriving)
    arriving.delete(event.messageID)

    return { ...state, arriving }
  }

  const rows = event.rows

  if (event.sessionID !== state.sessionID)
    return {
      status: "tracking",
      sessionID: event.sessionID,
      seen: new Set(rows.flatMap((row) => rowAnchor(row) ?? [])),
      arriving: EMPTY,
    }

  const unseen = rows.some((row) => {
    const anchor = rowAnchor(row)

    return anchor !== undefined && !state.seen.has(anchor)
  })

  if (!unseen && (event.busy || state.arriving.size === 0)) return state

  const last = rows.findLastIndex((row) => {
    const anchor = rowAnchor(row)

    return anchor !== undefined && state.seen.has(anchor)
  })

  // With no seen row left to land below (a first page, or rows replaced wholesale), every row is history.
  const steers =
    event.busy && last >= 0
      ? rows
          .slice(last + 1)
          .filter((row) => Predicate.isTagged(row, "UserMessage") && !state.seen.has(row.userMessageID))
          .map((row) => row.userMessageID)
      : []

  return {
    status: "tracking",
    sessionID: state.sessionID,
    seen: unseen ? new Set([...state.seen, ...rows.flatMap((row) => rowAnchor(row) ?? [])]) : state.seen,
    arriving: !event.busy ? EMPTY : steers.length > 0 ? new Set([...state.arriving, ...steers]) : state.arriving,
  }
}

export function shouldGrowUserMessage(state: SteerArrivalState, messageID: string) {
  return state.status === "tracking" && state.arriving.has(messageID)
}

// Each row stands for the message that produced it; message IDs are unique across user, shell and assistant messages.
function rowAnchor(row: TimelineRow.TimelineRow) {
  if (Predicate.isTagged(row, "UserMessage")) return row.userMessageID

  if (Predicate.isTagged(row, "Shell")) return row.messageID

  if (Predicate.isTagged(row, "Thinking")) return row.ref.messageID

  if (!Predicate.isTagged(row, "AssistantPart")) return

  return row.group.type === "part" ? row.group.ref.messageID : row.group.refs[0]?.messageID
}
