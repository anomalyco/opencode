import { UserMessage, AssistantMessage } from "@opencode/schema/session"
import type { Part } from "@opencode/schema/part"
import type { SessionStatus } from "@opencode/schema/session"
import { MessageComment } from "./message-comment"
import { diffSummaries } from "./diff-summaries"
import { groupParts, renderable, assistantId } from "./shared"
import { Equal } from "@opencode/common/equal"
import type { SessionStore } from "./session-store"

export type TimelineRowMap = {
  [K in TimelineRow.TimelineRow["_tag"]]: Extract<TimelineRow.TimelineRow, { _tag: K }>
}

export function sameKeys(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  for (const i of a.keys()) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export namespace TimelineRow {
  export class CommentStrip {
    readonly _tag = "CommentStrip" as const
    constructor(public props: { userMessageID: string }) {}
    get userMessageID() {
      return this.props.userMessageID
    }
  }

  export class UserMessage {
    readonly _tag = "UserMessage" as const
    constructor(public props: { userMessageID: string }) {}
    get userMessageID() {
      return this.props.userMessageID
    }
  }

  export class TurnDivider {
    readonly _tag = "TurnDivider" as const
    constructor(public props: { userMessageID: string; label: string }) {}
    get userMessageID() {
      return this.props.userMessageID
    }
    get label() {
      return this.props.label
    }
  }

  export class AssistantPart {
    readonly _tag = "AssistantPart" as const
    constructor(
      public props: {
        userMessageID: string
        group: { key: string; messageID: string }
      },
    ) {}
    get userMessageID() {
      return this.props.userMessageID
    }
    get group() {
      return this.props.group
    }
  }

  export class Thinking {
    readonly _tag = "Thinking" as const
    constructor(public props: { userMessageID: string }) {}
    get userMessageID() {
      return this.props.userMessageID
    }
  }

  export class DiffSummary {
    readonly _tag = "DiffSummary" as const
    constructor(public props: { userMessageID: string }) {}
    get userMessageID() {
      return this.props.userMessageID
    }
  }

  export class Error {
    readonly _tag = "Error" as const
    constructor(public props: { userMessageID: string; error: string }) {}
    get userMessageID() {
      return this.props.userMessageID
    }
  }

  export class Retry {
    readonly _tag = "Retry" as const
    constructor(public props: { userMessageID: string }) {}
    get userMessageID() {
      return this.props.userMessageID
    }
  }

  export class BottomSpacer {
    readonly _tag = "BottomSpacer" as const
    constructor() {}
  }

  export type TimelineRow =
    | CommentStrip
    | UserMessage
    | TurnDivider
    | AssistantPart
    | Thinking
    | DiffSummary
    | Error
    | Retry
    | BottomSpacer

  export const key = (row: TimelineRow) => {
    if (!row) return "unknown"
    switch (row._tag) {
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
      case "BottomSpacer":
        return "bottom-spacer"
    }
  }

  export function equals(a: TimelineRow, b: TimelineRow) {
    return Equal.equals(a, b)
  }
}

export namespace Timeline {
  export function constructMessageRows(
    userMessage: UserMessage,
    getMessageParts: (messageID: string) => Part[],
    assistantMessages: AssistantMessage[],
    index: number,
    showReasoning: boolean,
    status: SessionStatus["type"],
    isActive: boolean,
  ) {
    const rows: TimelineRow.TimelineRow[] = []

    const previousUserMessage = index > 0
    const userParts = getMessageParts(userMessage.id)
    const comments = userParts.flatMap((p) => MessageComment.fromPart(p) ?? [])
    const compaction = userParts.some((p) => p.type === "compaction")
    const interruptedMessageIndex = assistantMessages.findIndex((m) => m.error?.name === "MessageAbortedError")
    const interrupted = interruptedMessageIndex !== -1
    const error = assistantMessages.find((m) => m.error && m.error.name !== "MessageAbortedError")?.error

    const assistantPartRefs = assistantMessages.flatMap((message, messageIndex) =>
      getMessageParts(message.id)
        .filter((part) => renderable(part, showReasoning))
        .map((part) => ({ messageID: message.id, messageIndex, part })),
    )
    const assistantItems =
      interrupted && !compaction
        ? [
            ...groupParts(assistantPartRefs.filter((ref) => ref.messageIndex <= interruptedMessageIndex)).map(
              (group) => ({
                type: "part" as const,
                group,
              }),
            ),
            { type: "interrupted" as const },
            ...groupParts(assistantPartRefs.filter((ref) => ref.messageIndex > interruptedMessageIndex)).map(
              (group) => ({
                type: "part" as const,
                group,
              }),
            ),
          ]
        : groupParts(assistantPartRefs).map((group) => ({ type: "part" as const, group }))
    if (comments.length > 0)
      rows.push(
        new TimelineRow.CommentStrip({
          userMessageID: userMessage.id,
          previousUserMessage,
        }),
      )

    rows.push(new TimelineRow.UserMessage({ userMessageID: userMessage.id }))

    if (previousUserMessage)
      rows.push(
        new TimelineRow.TurnDivider({ userMessageID: userMessage.id, label: `Continue working` }),
      )
    else
      rows.push(
        new TimelineRow.TurnDivider({
          userMessageID: userMessage.id,
          label: index === 0 && status === "idle" && isActive ? "" : "New Thread",
        }),
      )

    for (const item of assistantItems) {
      if (item.type === "interrupted") continue
      rows.push(
        new TimelineRow.AssistantPart({
          userMessageID: userMessage.id,
          group: { key: assistantId(item.group), messageID: item.group[0].messageID },
        }),
      )
    }

    for (const message of assistantMessages) {
      if (message.reasoning?.length && showReasoning)
        rows.push(new TimelineRow.Thinking({ userMessageID: userMessage.id }))
    }

    if (isActive && status === "retry") rows.push(new TimelineRow.Retry({ userMessageID: userMessage.id }))

    if (error) {
      const summaries = diffSummaries(assistantMessages, getMessageParts)
      if (summaries) rows.push(new TimelineRow.DiffSummary({ userMessageID: userMessage.id }))
      rows.push(
        new TimelineRow.Error({ userMessageID: userMessage.id, error: error.name }),
      )
    }

    return rows
  }
}
