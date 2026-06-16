import { Binary } from "@opencode-ai/core/util/binary"
import type { AssistantMessage, Message, Part, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2"
import { createMemo, mapArray, type Accessor } from "solid-js"
import { Timeline, TimelineRow } from "./rows"

const emptyAssistantMessages: AssistantMessage[] = []

export function createTimelineProjection(input: {
  messages: Accessor<Message[]>
  userMessages: Accessor<UserMessage[]>
  parts: (messageID: string) => Part[]
  status: Accessor<SessionStatus>
  showReasoningSummaries: Accessor<boolean>
}) {
  const messageByID = createMemo(() => new Map(input.messages().map((message) => [message.id, message] as const)))
  const assistantMessagesByParent = createMemo(() => {
    const result = new Map<string, AssistantMessage[]>()
    input.messages().forEach((message) => {
      if (message.role !== "assistant") return
      const messages = result.get(message.parentID)
      if (messages) {
        messages.push(message)
        return
      }
      result.set(message.parentID, [message])
    })
    return result
  })
  const activeMessageID = createMemo(() => {
    const parentID = input.messages().findLast(
      (message): message is AssistantMessage => message.role === "assistant" && typeof message.time.completed !== "number",
    )?.parentID
    if (parentID) {
      const messages = input.messages()
      const result = Binary.search(messages, parentID, (message) => message.id)
      const message = result.found ? messages[result.index] : messages.find((item) => item.id === parentID)
      if (message?.role === "user") return message.id
    }

    if (input.status().type === "idle") return
    return input.messages().findLast((message) => message.role === "user")?.id
  })
  const messageRowMemos = createMemo(
    mapArray(input.userMessages, (userMessage, indexAccessor) =>
      createMemo((previous: TimelineRow.TimelineRow[] | undefined) =>
        reuseTimelineRows(
          previous,
          Timeline.constructMessageRows(
            userMessage,
            input.parts,
            assistantMessagesByParent().get(userMessage.id) ?? emptyAssistantMessages,
            indexAccessor(),
            input.showReasoningSummaries(),
            input.status().type,
            activeMessageID() === userMessage.id,
          ),
        ),
      ),
    ),
  )
  const rows = createMemo((previous: TimelineRow.TimelineRow[] | undefined) =>
    reuseTimelineRows(
      previous,
      messageRowMemos().flatMap((memo) => memo()),
    ),
  )
  const rowByKey = createMemo(() => new Map(rows().map((row) => [TimelineRow.key(row), row] as const)))
  const messageRowIndex = createMemo(() => {
    const result = new Map<string, number>()
    rows().forEach((row, index) => {
      if (!("userMessageID" in row) || result.has(row.userMessageID)) return
      result.set(row.userMessageID, index)
    })
    return result
  })
  const messageLastRowIndex = createMemo(() => {
    const result = new Map<string, number>()
    rows().forEach((row, index) => {
      if ("userMessageID" in row) result.set(row.userMessageID, index)
    })
    return result
  })
  const lastAssistantGroupKey = createMemo(() => {
    const result = new Map<string, string>()
    rows().forEach((row) => {
      if (row._tag === "AssistantPart") result.set(row.userMessageID, row.group.key)
    })
    return result
  })

  return {
    activeMessageID,
    assistantMessagesByParent,
    lastAssistantGroupKey,
    messageByID,
    messageRowIndex,
    messageLastRowIndex,
    rowByKey,
    rows,
  }
}

export function reuseTimelineRows(previous: TimelineRow.TimelineRow[] | undefined, rows: TimelineRow.TimelineRow[]) {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [TimelineRow.key(row), row] as const))
  const next = rows.map((row) => {
    const existing = byKey.get(TimelineRow.key(row))
    if (!existing) return row
    return TimelineRow.equals(existing, row) ? existing : row
  })
  if (previous.length === next.length && previous.every((row, index) => row === next[index])) return previous
  return next
}
