import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import type { PartGroup } from "../../components/message-part"

export type SummaryDiff = SnapshotFileDiff & { file: string }

export namespace TimelineRow {
  export class TurnGap {
    readonly _tag = "TurnGap"
    readonly userMessageID: string
    constructor(props: { userMessageID: string }) {
      this.userMessageID = props.userMessageID
    }
  }
  export class CommentStrip {
    readonly _tag = "CommentStrip"
    readonly userMessageID: string
    constructor(props: { userMessageID: string }) {
      this.userMessageID = props.userMessageID
    }
  }
  export class UserMessage {
    readonly _tag = "UserMessage"
    readonly userMessageID: string
    readonly anchor: boolean
    constructor(props: { userMessageID: string; anchor: boolean }) {
      this.userMessageID = props.userMessageID
      this.anchor = props.anchor
    }
  }
  export class TurnDivider {
    readonly _tag = "TurnDivider"
    readonly userMessageID: string
    readonly label: "compaction" | "interrupted"
    constructor(props: { userMessageID: string; label: "compaction" | "interrupted" }) {
      this.userMessageID = props.userMessageID
      this.label = props.label
    }
  }
  export class AssistantPart {
    readonly _tag = "AssistantPart"
    readonly userMessageID: string
    readonly group: PartGroup
    readonly previousAssistantPart: boolean
    constructor(props: { userMessageID: string; group: PartGroup; previousAssistantPart: boolean }) {
      this.userMessageID = props.userMessageID
      this.group = props.group
      this.previousAssistantPart = props.previousAssistantPart
    }
  }
  export class Thinking {
    readonly _tag = "Thinking"
    readonly userMessageID: string
    readonly reasoningHeading?: string
    constructor(props: { userMessageID: string; reasoningHeading?: string }) {
      this.userMessageID = props.userMessageID
      this.reasoningHeading = props.reasoningHeading
    }
  }
  export class DiffSummary {
    readonly _tag = "DiffSummary"
    readonly userMessageID: string
    readonly diffs: SummaryDiff[]
    constructor(props: { userMessageID: string; diffs: SummaryDiff[] }) {
      this.userMessageID = props.userMessageID
      this.diffs = props.diffs
    }
  }
  export class Error {
    readonly _tag = "Error"
    readonly userMessageID: string
    readonly text: string
    constructor(props: { userMessageID: string; text: string }) {
      this.userMessageID = props.userMessageID
      this.text = props.text
    }
  }
  export class Retry {
    readonly _tag = "Retry"
    readonly userMessageID: string
    constructor(props: { userMessageID: string }) {
      this.userMessageID = props.userMessageID
    }
  }

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
      case "Retry":
        return a.userMessageID === b.userMessageID
      case "UserMessage": {
        const next = b as UserMessage
        return a.userMessageID === next.userMessageID && a.anchor === next.anchor
      }
      case "TurnDivider": {
        const next = b as TurnDivider
        return a.userMessageID === next.userMessageID && a.label === next.label
      }
      case "AssistantPart": {
        const next = b as AssistantPart
        return (
          a.userMessageID === next.userMessageID &&
          a.previousAssistantPart === next.previousAssistantPart &&
          sameGroup(a.group, next.group)
        )
      }
      case "Thinking": {
        const next = b as Thinking
        return a.userMessageID === next.userMessageID && a.reasoningHeading === next.reasoningHeading
      }
      case "DiffSummary": {
        const next = b as DiffSummary
        return (
          a.userMessageID === next.userMessageID &&
          a.diffs.length === next.diffs.length &&
          a.diffs.every((diff, index) => JSON.stringify(diff) === JSON.stringify(next.diffs[index]))
        )
      }
      case "Error": {
        const next = b as Error
        return a.userMessageID === next.userMessageID && a.text === next.text
      }
    }
  }
}

function sameGroup(a: PartGroup, b: PartGroup) {
  if (a === b) return true
  if (a.key !== b.key || a.type !== b.type) return false
  if (a.type === "part") {
    if (b.type !== "part") return false
    return a.ref.messageID === b.ref.messageID && a.ref.partID === b.ref.partID
  }
  if (b.type !== "context" || a.refs.length !== b.refs.length) return false
  return a.refs.every(
    (ref, index) => ref.messageID === b.refs[index]?.messageID && ref.partID === b.refs[index]?.partID,
  )
}
