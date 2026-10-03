import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { sameGroup, type PartGroup } from "@opencode-ai/session-ui/message-part-groups"
import { Data, Equal } from "effect"

export type SummaryDiff = SnapshotFileDiff & { file: string }

export namespace TimelineRow {
  export class TurnGap extends Data.TaggedClass("TurnGap")<{
    userMessageID: string
  }> {}
  export class CommentStrip extends Data.TaggedClass("CommentStrip")<{
    userMessageID: string
  }> {}
  export class UserMessage extends Data.TaggedClass("UserMessage")<{
    userMessageID: string
    anchor: boolean
  }> {}
  export class TurnDivider extends Data.TaggedClass("TurnDivider")<{
    userMessageID: string
    label: "compaction" | "interrupted"
  }> {}
  export class AssistantPart extends Data.TaggedClass("AssistantPart")<{
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
  }> {}
  export class Thinking extends Data.TaggedClass("Thinking")<{
    userMessageID: string
    reasoningHeading?: string
  }> {}
  export class DiffSummary extends Data.TaggedClass("DiffSummary")<{
    userMessageID: string
    diffs: SummaryDiff[]
  }> {}
  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: string
    text: string
  }> {}
  export class Retry extends Data.TaggedClass("Retry")<{
    userMessageID: string
  }> {}

  export type TimelineRow =
    | TurnGap
    | CommentStrip
    | UserMessage
    | TurnDivider
    | AssistantPart
    | Thinking
    | DiffSummary
    | Error
    | Retry

  export const key = (row: TimelineRow) => {
    switch (row._tag) {
      case "TurnGap":
        return `turn-gap:${row.userMessageID}`
      case "CommentStrip":
        return `comment-strip:${row.userMessageID}`
      case "UserMessage":
        return `user-message:${row.userMessageID}`
      case "TurnDivider":
        return `turn-divider:${row.userMessageID}:${row.label}`
      case "AssistantPart":
        return `assistant-part:${row.userMessageID}:${row.group.key}`
      case "Thinking":
        return `thinking:${row.userMessageID}`
      case "DiffSummary":
        return `diff-summary:${row.userMessageID}`
      case "Error":
        return `error:${row.userMessageID}`
      case "Retry":
        return `retry:${row.userMessageID}`
    }
  }

  export function equals(a: TimelineRow, b: TimelineRow) {
    if (a === b) return true
    if (a._tag !== b._tag) return false
    switch (a._tag) {
      case "TurnGap":
      case "CommentStrip":
        return a.userMessageID === (b as TurnGap | CommentStrip).userMessageID
      case "UserMessage": {
        const other = b as UserMessage
        return a.userMessageID === other.userMessageID && a.anchor === other.anchor
      }
      case "TurnDivider": {
        const other = b as TurnDivider
        return a.userMessageID === other.userMessageID && a.label === other.label
      }
      case "AssistantPart": {
        const other = b as AssistantPart
        return (
          a.userMessageID === other.userMessageID &&
          a.previousAssistantPart === other.previousAssistantPart &&
          sameGroup(a.group, other.group)
        )
      }
      case "Thinking": {
        const other = b as Thinking
        return a.userMessageID === other.userMessageID && a.reasoningHeading === other.reasoningHeading
      }
      case "DiffSummary": {
        const other = b as DiffSummary
        return a.userMessageID === other.userMessageID && Equal.equals(a.diffs, other.diffs)
      }
      case "Error": {
        const other = b as Error
        return a.userMessageID === other.userMessageID && a.text === other.text
      }
      case "Retry":
        return a.userMessageID === (b as Retry).userMessageID
    }
  }
}
