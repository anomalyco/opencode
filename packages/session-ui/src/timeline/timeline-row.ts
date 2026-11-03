import { Data, Match, Predicate } from "effect"

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
   * `free-limit` marks OpenCode Zen's daily free allowance running out and `go-limit` an OpenCode Go subscription's
   * usage limit. `budget-limit` marks an OpenCode Console budget
   * on all spend pausing paid models, and `model-budget-limit` one pausing only the models it covers. `resetAt` is when
   * the allowance or budget comes back, if known.
   */
  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: string
    text: string
    kind?: "free-limit" | "go-limit" | "budget-limit" | "model-budget-limit"
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

  // Every projection change compares each row with its previous version. Effect's structural `Equal.equals` hashes
  // every nested group and ref of the new row first, which cost milliseconds per change on long sessions. A field added
  // to a row needs a comparison here, or a change to only that field keeps the previous row.
  const sameFields: (row: TimelineRow) => (other: TimelineRow) => boolean = Match.typeTags<TimelineRow>()({
    TurnGap: () => (other: TimelineRow) => Predicate.isTagged(other, "TurnGap"),
    UserMessage: () => (other: TimelineRow) => Predicate.isTagged(other, "UserMessage"),
    Shell: (row) => (other: TimelineRow) => Predicate.isTagged(other, "Shell") && other.messageID === row.messageID,
    Notice: (row) => (other: TimelineRow) => Predicate.isTagged(other, "Notice") && other.messageID === row.messageID,
    TurnDivider: () => (other: TimelineRow) => Predicate.isTagged(other, "TurnDivider"),
    AssistantPart: (row) => (other: TimelineRow) =>
      Predicate.isTagged(other, "AssistantPart") &&
      other.previousAssistantPart === row.previousAssistantPart &&
      other.spacing === row.spacing &&
      sameGroup(other.group, row.group),
    Thinking: (row) => (other: TimelineRow) => Predicate.isTagged(other, "Thinking") && sameRef(other.ref, row.ref),
    Error: (row) => (other: TimelineRow) =>
      Predicate.isTagged(other, "Error") &&
      other.text === row.text &&
      other.kind === row.kind &&
      other.resetAt === row.resetAt,
    Retry: () => (other: TimelineRow) => Predicate.isTagged(other, "Retry"),
    CompactionQueued: (row) => (other: TimelineRow) =>
      Predicate.isTagged(other, "CompactionQueued") && other.inboxID === row.inboxID,
    TurnDiff: (row) => (other: TimelineRow) =>
      Predicate.isTagged(other, "TurnDiff") &&
      other.messageID === row.messageID &&
      other.from === row.from &&
      other.files.length === row.files.length &&
      other.files.every((file, index) => file === row.files[index]),
    Activity: () => (other: TimelineRow) => Predicate.isTagged(other, "Activity"),
  })

  export function equals(a: TimelineRow, b: TimelineRow) {
    return a === b || (a.userMessageID === b.userMessageID && sameFields(a)(b))
  }
}

function sameGroup(a: PartGroup, b: PartGroup) {
  if (a.key !== b.key) return false

  if (a.type === "part") return b.type === "part" && sameRef(a.ref, b.ref)

  return (
    b.type === a.type &&
    b.refs.length === a.refs.length &&
    a.refs.every((ref, index) => {
      const other = b.refs[index]

      return other !== undefined && sameRef(ref, other)
    })
  )
}

function sameRef(a: PartRef, b: PartRef) {
  return a.messageID === b.messageID && a.partID === b.partID
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
  Error: {
    userMessageID: string
    text: string
    kind?: "free-limit" | "go-limit" | "budget-limit" | "model-budget-limit"
    resetAt?: number
  }
  CompactionQueued: { userMessageID: string; inboxID: string }
  TurnDiff: { userMessageID: string; messageID: string; from: string; files: readonly string[] }
  Activity: { userMessageID: string }
}
