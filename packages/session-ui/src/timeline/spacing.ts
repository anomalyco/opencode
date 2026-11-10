import type { SessionMessageInfo } from "@opencode/client/promise"
import { Predicate } from "effect"
import { canonicalToolName } from "../message/current-tool-state"
import { TimelineRow } from "./timeline-row"

/**
 * The Activity timeline spaces rows by the block they belong to. What the user did, what the agent did in response,
 * and what happened to the session each form blocks; rows in one block sit a small gap apart and blocks a large one.
 */
export type TimelineBlock = "user" | "agent" | "event"

/**
 * The space above a row: small within its block, medium where it changes from one kind of row to another (the agent's
 * words, a card, a line of activity), large where a new block starts.
 */
export type TimelineGap = "s" | "m" | "l"

export function timelineBlock(
  row: TimelineRow.TimelineRow,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): TimelineBlock | undefined {
  if (Predicate.isTagged(row, "TurnGap")) return undefined

  if (Predicate.isTagged(row, "UserMessage") || Predicate.isTagged(row, "Shell")) return "user"

  if (Predicate.isTagged(row, "TurnDivider") || Predicate.isTagged(row, "CompactionQueued")) return "event"

  if (!Predicate.isTagged(row, "Notice")) return "agent"
  const message = messageByID.get(row.messageID)

  // A goal is the user's own message, shown as one.
  if (message?.type === "synthetic" && message.metadata?.source === "goal") return "user"

  return "event"
}

/**
 * Each row's gap above it, by key. A row continuing the block above gets the small gap, one starting a new block the
 * large one; the first row gets none. Background work reporting back always starts a block. Turn gaps stay out of it: they only hold the user's consecutive messages
 * together, so a row after one compares with the row before it.
 */
export function timelineGaps(
  rows: readonly TimelineRow.TimelineRow[],
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
) {
  const gaps = new Map<string, TimelineGap>()

  rows.reduce<{ block: TimelineBlock; kind: TimelineItem } | undefined>((previous, row) => {
    const block = timelineBlock(row, messageByID)

    if (!block) return previous
    const kind = timelineItem(row, messageByID)

    // Background work reporting back starts a new stretch of agent work, which the agent's reply continues.
    const starts = Predicate.isTagged(row, "BackgroundEvents")

    if (previous)
      gaps.set(TimelineRow.key(row), previous.block !== block || starts ? "l" : previous.kind !== kind ? "m" : "s")

    return { block, kind }
  }, undefined)

  return gaps
}

/**
 * What a row shows within its block: the agent's words, a card (a shell or a file's changes), or a line of activity. The
 * medium gap separates rows of different kinds, so a card or a paragraph never crowds the lines beside it.
 */
type TimelineItem = "prose" | "card" | "line"

function timelineItem(
  row: TimelineRow.TimelineRow,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): TimelineItem {
  if (!Predicate.isTagged(row, "AssistantPart")) return "line"
  const group = row.group

  if (group.type === "file") return "card"

  if (group.type !== "part") return "line"

  // The projection forms a text part's ID as `<message>:text:<n>`.
  if (group.ref.partID.startsWith(`${group.ref.messageID}:text:`)) return "prose"
  const message = messageByID.get(group.ref.messageID)
  const tool =
    message?.type === "assistant"
      ? message.content.find((content) => content.type === "tool" && content.id === group.ref.partID)
      : undefined

  if (tool?.type !== "tool" || tool.state.status === "error") return "line"

  return canonicalToolName(tool.name) === "shell" ? "card" : "line"
}

/**
 * The gap above the status line below a working turn. It stands in for the agent's next row, so it continues agent work
 * a small gap below, and starts it a large gap below anything else.
 */
export function timelineLaneGap(
  rows: readonly TimelineRow.TimelineRow[],
  turnID: string,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): Exclude<TimelineGap, "m"> | undefined {
  const last = rows.findLast((row) => row.userMessageID === turnID && timelineBlock(row, messageByID))

  if (!last) return undefined

  return timelineBlock(last, messageByID) === "agent" ? "s" : "l"
}
