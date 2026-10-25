import { Data, Equal, Match } from "effect"

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
      type: "file" | "read"
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
    spacing?: "tool" | "content"
  }> {}

  export class Thinking extends Data.TaggedClass("Thinking")<{
    userMessageID: string
    ref: PartRef
  }> {}

  /**
   * `free-limit` marks OpenCode Zen's daily free allowance running out; `resetAt` is when the allowance comes back, if
   * known.
   */
  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: string
    text: string
    kind?: "free-limit"
    resetAt?: number
  }> {}

  export class Retry extends Data.TaggedClass("Retry")<{
    userMessageID: string
  }> {}

  /** A compaction the server has admitted but not started. */
  export class CompactionQueued extends Data.TaggedClass("CompactionQueued")<{
    userMessageID: string
    inboxID: string
  }> {}

  /**
   * The files a finished turn changed, shown once the Session goes idle. `messageID` is the
   * idle marker that ended the turn; `from` is the prompt that opened it, which names the turn
   * to the session diff route even when later prompts were steered in. `files` are the paths its
   * steps recorded, listed before the diff loads; the diff can omit a file a later step reverted.
   */
  export class TurnDiff extends Data.TaggedClass("TurnDiff")<{
    userMessageID: string
    messageID: string
    from: string
    files: readonly string[]
  }> {}

  /** Where the host shows the active turn's live status when undelivered input waits below it. */
  export class Activity extends Data.TaggedClass("Activity")<{
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
    | CompactionQueued
    | TurnDiff
    | Activity

  export const key: (row: TimelineRow) => string = Match.typeTags<TimelineRow>()({
    TurnGap: (row) => `turn-gap:${row.userMessageID}`,
    UserMessage: (row) => `user-message:${row.userMessageID}`,
    Shell: (row) => `shell:${row.messageID}`,
    Notice: (row) => `notice:${row.messageID}`,
    TurnDivider: (row) => `turn-divider:${row.userMessageID}`,
    // Keyed by part identity alone: a page boundary can truncate the leading turn,
    // and its rows regroup under the real user message once older history loads.
    // The group key already carries the owning message and part IDs.
    AssistantPart: (row) => `assistant-part:${row.group.type}:${row.group.key}`,
    Thinking: (row) => `thinking:${row.userMessageID}`,
    Error: (row) => `error:${row.userMessageID}`,
    Retry: (row) => `retry:${row.userMessageID}`,
    CompactionQueued: (row) => `compaction-queued:${row.inboxID}`,
    TurnDiff: (row) => `turn-diff:${row.messageID}`,
    // One live status exists at a time; it keeps its identity when the active turn changes.
    Activity: () => "activity",
  })

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
    spacing?: "tool" | "content"
  }
  Thinking: { userMessageID: string; ref: PartRef }
  Retry: { userMessageID: string }
  Error: { userMessageID: string; text: string; kind?: "free-limit"; resetAt?: number }
  CompactionQueued: { userMessageID: string; inboxID: string }
  TurnDiff: { userMessageID: string; messageID: string; from: string; files: readonly string[] }
  Activity: { userMessageID: string }
}
