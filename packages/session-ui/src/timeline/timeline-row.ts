import { Data, Equal } from "effect"

export type PartRef = {
  messageID: string
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
      type: "file"
      refs: PartRef[]
    }

export namespace TimelineRow {
  export class TurnGap extends Data.TaggedClass("TurnGap")<{
    userMessageID: string
  }> {}

  export class UserMessage extends Data.TaggedClass("UserMessage")<{
    userMessageID: string
  }> {}

  export class Shell extends Data.TaggedClass("Shell")<{
    userMessageID: string
    messageID: string
  }> {}

  export class Notice extends Data.TaggedClass("Notice")<{
    userMessageID: string
    messageID: string
  }> {}

  export class TurnDivider extends Data.TaggedClass("TurnDivider")<{
    userMessageID: string
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

  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: string
    text: string
  }> {}

  export class Retry extends Data.TaggedClass("Retry")<{
    userMessageID: string
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
      case "AssistantPart":
        return `assistant-part:${row.userMessageID}:${row.group.key}`
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
  TurnGap: { userMessageID: string }
  UserMessage: { userMessageID: string }
  Shell: { userMessageID: string; messageID: string }
  Notice: { userMessageID: string; messageID: string }
  TurnDivider: { userMessageID: string }
  AssistantPart: {
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
  }
  Thinking: { userMessageID: string; reasoningHeading?: string }
  Retry: { userMessageID: string }
  Error: { userMessageID: string; text: string }
}
