import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { Predicate } from "effect"
import { TimelineRow } from "../timeline/timeline-row"
import { resolveContent } from "./projection"
import { goal } from "./rules"

type Content = SessionMessageAssistant["content"][number]

/**
 * Rows are spaced by who did what: each thing the user did (a message, a command, a goal) stands apart, the agent's reply
 * reads as one stretch, and what happened to the session (Interrupted, a switch) sits together.
 */
export type TimelineBlock = "user" | "agent" | "event"

/** What a row or an item in an opened group shows: the agent's words, or its activity (a call, a file, a thought). */
export type TimelineItem = "prose" | "line"

/**
 * The space above a row: small between rows of activity in a reply or a run of session events, medium between the
 * agent's words and its activity, and large around each thing the user did and wherever a new block starts.
 */
export type TimelineGap = "s" | "m" | "l"

/**
 * Each row's gap above it, by key; the first row gets none. Background work reporting back always starts a block, which
 * the agent's reply continues. Turn gaps stay out of it: they only hold the user's consecutive messages together, so a
 * row after one compares with the row before it. A message joining the one above in a run sits closer still, which the
 * row renderer applies.
 */
export function timelineGaps(
  rows: readonly TimelineRow.TimelineRow[],
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
) {
  const gaps = new Map<string, TimelineGap>()

  rows.reduce<{ block: TimelineBlock; item: TimelineItem } | undefined>((previous, row) => {
    const block = rowBlock(row, messageByID)

    if (!block) return previous
    const item = rowItem(row, messageByID)

    if (previous) gaps.set(TimelineRow.key(row), gap(previous, { block, item }, reportsBack(row)))

    return { block, item }
  }, undefined)

  return gaps
}

/**
 * The gap above the status line below a working turn. It stands in for the agent's next line of activity, so it sits
 * where that row would. Before the turn shows anything, such as while a hidden thought streams, it stands in for the
 * turn's first row, so it sits where that row will land.
 */
export function laneGap(
  rows: readonly TimelineRow.TimelineRow[],
  turnID: string,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): TimelineGap | undefined {
  const last =
    rows.findLast((row) => row.userMessageID === turnID && rowBlock(row, messageByID)) ??
    rows.findLast((row) => rowBlock(row, messageByID))

  const block = last && rowBlock(last, messageByID)

  if (!last || !block) return undefined

  return gap({ block, item: rowItem(last, messageByID) }, { block: "agent", item: "line" }, false)
}

function gap(
  previous: { block: TimelineBlock; item: TimelineItem },
  current: { block: TimelineBlock; item: TimelineItem },
  starts: boolean,
): TimelineGap {
  // Each thing the user did stands on its own, apart from the reply before it and the one after.
  if (starts || previous.block !== current.block || current.block === "user") return "l"

  // The agent's words sit a little apart from its activity, so each reads as what it is.
  return previous.item === current.item ? "s" : "m"
}

/** What one part shows, so an opened group spaces its items as the timeline spaces rows. */
export function contentItem(content: Content): TimelineItem {
  if (content.type === "text") return "prose"

  return "line"
}

function rowBlock(
  row: TimelineRow.TimelineRow,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): TimelineBlock | undefined {
  if (Predicate.isTagged(row, "TurnGap")) return undefined

  if (Predicate.isTagged(row, "UserMessage") || Predicate.isTagged(row, "Shell")) return "user"

  if (Predicate.isTagged(row, "TurnDivider") || Predicate.isTagged(row, "CompactionQueued")) return "event"

  if (!Predicate.isTagged(row, "Notice")) return "agent"

  return goal(messageByID.get(row.messageID)) ? "user" : "event"
}

function rowItem(row: TimelineRow.TimelineRow, messageByID: ReadonlyMap<string, SessionMessageInfo>): TimelineItem {
  if (!Predicate.isTagged(row, "AssistantPart")) return "line"
  const group = row.group

  if (group.type !== "part") return "line"
  const content = resolveContent(messageByID.get(group.ref.messageID), group.ref.partID)

  return content ? contentItem(content) : "line"
}

// Notices of background work finishing join an events group under the message's own ID.
function reportsBack(row: TimelineRow.TimelineRow) {
  return (
    Predicate.isTagged(row, "AssistantPart") &&
    row.group.type === "events" &&
    row.group.refs.some((ref) => ref.messageID === ref.partID)
  )
}
