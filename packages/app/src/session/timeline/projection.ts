import type { ModelRef, SessionMessageInfo, SessionStatus } from "@opencode-ai/client/promise"
import { reuseTimelineRows, Timeline, TimelineRow } from "@opencode-ai/session-ui/timeline/projection"
import { createMemo, type Accessor } from "solid-js"

export { reuseTimelineRows } from "@opencode-ai/session-ui/timeline/projection"

export function createTimelineProjection(input: {
  sessionMessages: Accessor<SessionMessageInfo[]>
  status: Accessor<SessionStatus>
  showReasoningSummaries: Accessor<boolean>
  shellToolDefaultOpen: Accessor<boolean>
  editToolDefaultOpen: Accessor<boolean>
  pendingUserMessageIDs: Accessor<ReadonlySet<string>>
}) {
  const sessionMessageByID = createMemo(
    () => new Map(input.sessionMessages().map((message) => [message.id, message] as const)),
  )
  const userContextByID = createMemo(() => {
    const result = new Map<string, { agent: string; model: ModelRef }>()
    let agent = ""
    let model: ModelRef = { id: "", providerID: "" }
    let userID: string | undefined
    input.sessionMessages().forEach((message) => {
      if (message.type === "agent-switched") agent = message.agent
      if (message.type === "model-switched") model = message.model
      if (message.type === "user") {
        userID = message.id
        const metadata = message.metadata
        const localAgent = typeof metadata?.agent === "string" ? metadata.agent : agent
        const localModel = metadata?.model
        const localModelID =
          localModel && typeof localModel === "object" && !Array.isArray(localModel)
            ? typeof localModel.id === "string"
              ? localModel.id
              : typeof localModel.modelID === "string"
                ? localModel.modelID
                : undefined
            : undefined
        result.set(message.id, {
          agent: localAgent,
          model:
            localModel &&
            typeof localModel === "object" &&
            !Array.isArray(localModel) &&
            localModelID &&
            typeof localModel.providerID === "string"
              ? {
                  id: localModelID,
                  providerID: localModel.providerID,
                  variant: typeof localModel.variant === "string" ? localModel.variant : undefined,
                }
              : model,
        })
      }
      if (message.type === "shell") userID = undefined
      if (message.type !== "assistant") return
      agent = message.agent
      model = message.model
      if (userID) result.set(userID, { agent, model })
    })
    return result
  })
  const assistantMessagesByParent = createMemo(() => {
    const result = new Map<string, Extract<SessionMessageInfo, { type: "assistant" }>[]>()
    let userID: string | undefined
    input.sessionMessages().forEach((message) => {
      if (message.type === "user") userID = message.id
      if (message.type === "shell") userID = undefined
      if (message.type !== "assistant") return
      if (!userID) userID = message.id
      const messages = result.get(userID)
      if (messages) {
        messages.push(message)
        return
      }
      result.set(userID, [message])
    })
    return result
  })
  const projection = createMemo(() =>
    Timeline.constructSessionMessageRows(
      input.sessionMessages(),
      input.showReasoningSummaries(),
      input.status(),
      input.pendingUserMessageIDs(),
      input.shellToolDefaultOpen(),
      input.editToolDefaultOpen(),
    ),
  )
  const activeMessageID = createMemo(() => projection().activeMessageID)
  const rows = createMemo((previous: TimelineRow.TimelineRow[] | undefined) =>
    reuseTimelineRows(previous, projection().rows),
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
    messageByID: sessionMessageByID,
    messageRowIndex,
    messageLastRowIndex,
    rowByKey,
    rows,
    sessionMessageByID,
    userContextByID,
  }
}
