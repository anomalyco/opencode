import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { Predicate } from "effect"
import { TimelineRow } from "../timeline/timeline-row"
import { resolveContent } from "./projection"
import { goal, toolRule } from "./rules"

type Content = SessionMessageAssistant["content"][number]

/**
 * Rows are spaced by the block they belong to: what the user did, what the agent did in reply, and what happened to the
 * session.
 */
export type TimelineBlock = "user" | "agent" | "event"

/**
 * What a row or an item in an opened group shows: the agent's words, a card (a command's output or a file's changes),
 * or a line of activity.
 */
export type TimelineItem = "prose" | "card" | "line"

/**
 * The space above a row: small within its block, medium where it changes from one kind of item to another, large
 * where a new block starts.
 */
export type TimelineGap = "s" | "m" | "l"

/**
 * Each row's gap above it, by key; the first row gets none. Background work reporting back always starts a block, which
 * the agent's reply continues. Turn gaps stay out of it: they only hold the user's consecutive messages together, so a
 * row after one compares with the row before it.
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

    if (previous)
      gaps.set(
        TimelineRow.key(row),
        previous.block !== block || reportsBack(row) ? "l" : previous.item !== item ? "m" : "s",
      )

    return { block, item }
  }, undefined)

  return gaps
}

/**
 * The gap above the status line below a working turn. It stands in for the agent's next row, so it continues agent work
 * a small gap below, and starts it a large gap below anything else.
 */
export function laneGap(
  rows: readonly TimelineRow.TimelineRow[],
  turnID: string,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): Exclude<TimelineGap, "m"> | undefined {
  const last = rows.findLast((row) => row.userMessageID === turnID && rowBlock(row, messageByID))

  if (!last) return undefined

  return rowBlock(last, messageByID) === "agent" ? "s" : "l"
}

/** What one part shows, so an opened group spaces its items as the timeline spaces rows. */
export function contentItem(content: Content): TimelineItem {
  if (content.type === "text") return "prose"

  if (content.type === "reasoning" || content.state.status === "error") return "line"
  const shape = toolRule(content).shape

  return shape === "card" || shape === "file" ? "card" : "line"
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

  if (group.type === "file") return "card"

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
