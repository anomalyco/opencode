import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { Predicate } from "effect"
import type { TimelineRow } from "./timeline-row"

/** A user message's place in a run of consecutive user messages: joined to the one above, below, or both. */
export type UserRun = { above: boolean; below: boolean }

/** What a user message brings to a run: its delivery, the agent and model its meta line names, and its surfaces. */
export type UserRunMember = {
  kind: "sent" | "pending"
  agent: string
  model: SessionMessageAssistant["model"]
  /** It has a text bubble, the surface that carries a run's meta line. */
  text: boolean
  /** Attachments sit above its bubble. */
  attachments: boolean
}

/** Layout moves in a run settle on Kit's calm spring: .4 s, bounce 0. */
export const userRunSpring = { omega: (2 * Math.PI) / 0.4, zeta: 1 }

/**
 * Like the iOS app's grouped corners, consecutive user messages with nothing but turn gaps between them read as
 * one block under a single meta line. Text bubbles with the same agent and model join, and steers waiting for
 * delivery group the same way, but never with a sent message. An agent, model, location or compaction boundary
 * between them ends the run even when the timeline hides its notice.
 */
export function userMessageRuns(
  rows: readonly TimelineRow.TimelineRow[],
  messages: readonly SessionMessageInfo[],
  member: (messageID: string) => UserRunMember | undefined,
) {
  const segments = boundarySegments(messages)
  const members = rows.filter((row) => !Predicate.isTagged(row, "TurnGap"))

  const joins = (above: TimelineRow.TimelineRow | undefined, below: TimelineRow.TimelineRow | undefined) => {
    if (!Predicate.isTagged(above, "UserMessage") || !Predicate.isTagged(below, "UserMessage")) return false
    const upper = member(above.userMessageID)
    const lower = member(below.userMessageID)

    return (
      !!upper &&
      !!lower &&
      upper.kind === lower.kind &&
      upper.text &&
      lower.text &&
      !lower.attachments &&
      upper.agent === lower.agent &&
      upper.model.providerID === lower.model.providerID &&
      upper.model.id === lower.model.id &&
      upper.model.variant === lower.model.variant &&
      segments.get(above.userMessageID) === segments.get(below.userMessageID)
    )
  }

  return new Map(
    members.flatMap((row, index) =>
      Predicate.isTagged(row, "UserMessage")
        ? [
            [
              row.userMessageID,
              { above: joins(members[index - 1], row), below: joins(row, members[index + 1]) } satisfies UserRun,
            ] as const,
          ]
        : [],
    ),
  )
}

/** Each user message's count of agent, model, location and compaction boundaries before it. */
function boundarySegments(messages: readonly SessionMessageInfo[]) {
  const segments = new Map<string, number>()
  let segment = 0
  messages.forEach((message) => {
    if (
      message.type === "agent-switched" ||
      message.type === "model-switched" ||
      message.type === "location-switched" ||
      message.type === "compaction"
    )
      segment += 1

    if (message.type === "user") segments.set(message.id, segment)
  })

  return segments
}
