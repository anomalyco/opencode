import type { SessionMessage } from "@opencode/schema/session-message"
import { Data, Equal } from "effect"

export type PartRef = {
  messageID: SessionMessage.ID
  partID: string
}

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }
  | {
      key: string
      type: "file" | "read"
      refs: PartRef[]
    }

export namespace TimelineRow {
  export class TurnGap extends Data.TaggedClass("TurnGap")<{
    userMessageID: SessionMessage.ID
  }> {}

  export class UserMessage extends Data.TaggedClass("UserMessage")<{
    userMessageID: SessionMessage.ID
  }> {}

  export class Shell extends Data.TaggedClass("Shell")<{
    userMessageID: SessionMessage.ID
    messageID: SessionMessage.ID
  }> {}

  export class Notice extends Data.TaggedClass("Notice")<{
    userMessageID: SessionMessage.ID
    messageID: SessionMessage.ID
  }> {}

  export class TurnDivider extends Data.TaggedClass("TurnDivider")<{
    userMessageID: SessionMessage.ID
  }> {}

  export class AssistantPart extends Data.TaggedClass("AssistantPart")<{
    userMessageID: SessionMessage.ID
    group: PartGroup
    previousAssistantPart: boolean
    spacing?: "tool" | "content"
  }> {}

  export class Thinking extends Data.TaggedClass("Thinking")<{
    userMessageID: SessionMessage.ID
    ref: PartRef
  }> {}

  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: SessionMessage.ID
    text: string
  }> {}

  export class Retry extends Data.TaggedClass("Retry")<{
    userMessageID: SessionMessage.ID
  }> {}

  export type TimelineRow =
    | TurnGap
    | UserMessage
    | Shell
    | Notice
    | TurnDivider
    | AssistantPart
    | Thinking
    | Error
    | Retry

  export const key = (row: TimelineRow): string => {
    switch (row._tag) {
      case "TurnGap":
        return `turn-gap:${row.userMessageID}`
      case "UserMessage":
        return `user-message:${row.userMessageID}`
      case "Shell":
        return `shell:${row.messageID}`
      case "Notice":
        return `notice:${row.messageID}`
      case "TurnDivider":
        return `turn-divider:${row.userMessageID}`
      // Keyed by part identity alone: a page boundary can truncate the leading turn,
      // and its rows regroup under the real user message once older history loads.
      // The group key already carries the owning message and part IDs.
      case "AssistantPart":
        return `assistant-part:${row.group.type}:${row.group.key}`
      case "Thinking":
        return `thinking:${row.userMessageID}`
      case "Error":
        return `error:${row.userMessageID}`
      case "Retry":
        return `retry:${row.userMessageID}`
    }
    return row
  }

  export function equals(a: TimelineRow, b: TimelineRow) {
    return Equal.equals(a, b)
  }
}

export type TimelineRowMap = {
  TurnGap: { userMessageID: SessionMessage.ID }
  UserMessage: { userMessageID: SessionMessage.ID }
  Shell: { userMessageID: SessionMessage.ID; messageID: SessionMessage.ID }
  Notice: { userMessageID: SessionMessage.ID; messageID: SessionMessage.ID }
  TurnDivider: { userMessageID: SessionMessage.ID }
  AssistantPart: {
    userMessageID: SessionMessage.ID
    group: PartGroup
    previousAssistantPart: boolean
    spacing?: "tool" | "content"
  }
  Thinking: { userMessageID: SessionMessage.ID; ref: PartRef }
  Retry: { userMessageID: SessionMessage.ID }
  Error: { userMessageID: SessionMessage.ID; text: string }
}
