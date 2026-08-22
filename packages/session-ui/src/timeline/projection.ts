import type {
  ModelRef,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
  SessionStatus,
} from "@opencode-ai/client/promise"
import { Option, Schema } from "effect"
import { createMemo, type Accessor } from "solid-js"
import { TimelineRow, type PartGroup, type PartRef, type TimelineRowMap } from "./timeline-row"

export { TimelineRow, type PartGroup, type PartRef, type TimelineRowMap }

type Notice = Exclude<SessionMessageInfo, { type: "user" | "assistant" | "shell" }>
type Entry = { type: "assistant"; message: SessionMessageAssistant } | { type: "notice"; message: Notice }
type Content = SessionMessageAssistant["content"][number]
type GroupRow = Extract<TimelineRow.TimelineRow, { _tag: "AssistantPart" }>
type PriorGroup = { index: number; row: GroupRow }

const contextTools = new Set(["read", "glob", "grep", "list"])
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export type TimelineProjectionInput = {
  sessionMessages: SessionMessageInfo[]
  status: SessionStatus
  showReasoningSummaries: boolean
  previousRows?: TimelineRow.TimelineRow[]
}

export function createTimelineProjection(input: TimelineProjectionInput) {
  const sessionMessageByID = new Map(input.sessionMessages.map((message) => [message.id, message] as const))
  const projection = Timeline.constructSessionMessageRows(
    input.sessionMessages,
    input.showReasoningSummaries,
    input.status,
  )
  const rows = reuseTimelineRows(input.previousRows, projection.rows)
  const rowByKey = new Map(rows.map((row) => [TimelineRow.key(row), row] as const))
  const messageRowIndex = new Map<string, number>()
  const messageLastRowIndex = new Map<string, number>()
  const lastAssistantGroupKey = new Map<string, string>()

  rows.forEach((row, index) => {
    if (!messageRowIndex.has(row.userMessageID)) messageRowIndex.set(row.userMessageID, index)
    messageLastRowIndex.set(row.userMessageID, index)
    if (row._tag === "AssistantPart") lastAssistantGroupKey.set(row.userMessageID, row.group.key)
  })

  return {
    activeMessageID: projection.activeMessageID,
    assistantMessagesByParent: indexAssistantMessages(input.sessionMessages),
    lastAssistantGroupKey,
    messageByID: sessionMessageByID,
    messageRowIndex,
    messageLastRowIndex,
    rowByKey,
    rows,
    sessionMessageByID,
    userContextByID: indexUserContext(input.sessionMessages),
  }
}

export function createReactiveTimelineProjection(input: {
  sessionMessages: Accessor<SessionMessageInfo[]>
  status: Accessor<SessionStatus>
  showReasoningSummaries: Accessor<boolean>
}) {
  const sessionMessageByID = createMemo(
    () => new Map(input.sessionMessages().map((message) => [message.id, message] as const)),
  )
  const userContextByID = createMemo(() => indexUserContext(input.sessionMessages()))
  const assistantMessagesByParent = createMemo(() => indexAssistantMessages(input.sessionMessages()))
  const projection = createMemo(() =>
    Timeline.constructSessionMessageRows(input.sessionMessages(), input.showReasoningSummaries(), input.status()),
  )
  const activeMessageID = createMemo(() => projection().activeMessageID)
  const rows = createMemo((previous: TimelineRow.TimelineRow[] | undefined) =>
    reuseTimelineRows(previous, projection().rows),
  )
  const rowByKey = createMemo(() => new Map(rows().map((row) => [TimelineRow.key(row), row] as const)))
  const messageRowIndex = createMemo(() => {
    const result = new Map<string, number>()
    rows().forEach((row, index) => {
      if (result.has(row.userMessageID)) return
      result.set(row.userMessageID, index)
    })
    return result
  })
  const messageLastRowIndex = createMemo(() => {
    const result = new Map<string, number>()
    rows().forEach((row, index) => result.set(row.userMessageID, index))
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

export namespace Timeline {
  export function constructSessionMessageRows(
    messages: SessionMessageInfo[],
    showReasoning: boolean,
    status: SessionStatus,
  ) {
    type Turn = {
      id: string
      time: { created: number }
      user?: SessionMessageUser
      shell?: SessionMessageShell
      entries: Entry[]
    }

    const turns: Turn[] = []
    const turnByUserID = new Map<string, Turn>()
    const leading: Notice[] = []
    let current: Turn | undefined

    messages.forEach((message) => {
      if (isNotice(message)) {
        if (current) current.entries.push({ type: "notice", message })
        if (!current) leading.push(message)
        return
      }
      if (message.type === "shell") {
        const turn: Turn = { id: message.id, time: message.time, shell: message, entries: [] }
        turns.push(turn)
        current = turn
        return
      }
      if (message.type === "user") {
        if (turnByUserID.has(message.id)) return
        const turn: Turn = { id: message.id, time: message.time, user: message, entries: [] }
        turns.push(turn)
        turnByUserID.set(message.id, turn)
        current = turn
        return
      }
      if (message.type !== "assistant") return
      const existing = current?.user ? current : undefined
      if (existing?.user) {
        existing.entries.push({ type: "assistant", message })
        current = existing
        return
      }
      if (current && !current.user && !current.shell) {
        current.entries.push({ type: "assistant", message })
        return
      }
      const turn: Turn = { id: message.id, time: message.time, entries: [{ type: "assistant", message }] }
      turns.push(turn)
      current = turn
    })

    const activeMessageID = turns.at(-1)?.id
    return {
      activeMessageID,
      rows: [
        ...leading.map(
          (message) => new TimelineRow.Notice({ userMessageID: turns[0]?.id ?? message.id, messageID: message.id }),
        ),
        ...turns.flatMap((turn, index) => {
          if (turn.shell)
            return [
              ...(index > 0 ? [new TimelineRow.TurnGap({ userMessageID: turn.id })] : []),
              new TimelineRow.Shell({ userMessageID: turn.id, messageID: turn.shell.id }),
              ...turn.entries.flatMap((entry) =>
                entry.type === "notice"
                  ? [new TimelineRow.Notice({ userMessageID: turn.id, messageID: entry.message.id })]
                  : [],
              ),
            ]
          return constructMessageRows(
            turn.user,
            turn.id,
            turn.entries,
            index,
            showReasoning,
            status,
            turn.id === activeMessageID,
          )
        }),
      ],
    }
  }

  export function constructMessageRows(
    userMessage: SessionMessageUser | undefined,
    turnID: string,
    entries: Entry[],
    index: number,
    showReasoning: boolean,
    status: SessionStatus,
    isActive: boolean,
  ) {
    const rows: TimelineRow.TimelineRow[] = []
    const assistantMessages = entries.flatMap((entry) => (entry.type === "assistant" ? [entry.message] : []))
    const previousUserMessage = index > 0
    const compaction = entries.some((entry) => entry.type === "notice" && entry.message.type === "compaction")
    const error = assistantMessages.at(-1)?.error
    const retry = assistantMessages.at(-1)?.retry
    const interrupted = error?.type.toLowerCase().includes("abort") || error?.type.toLowerCase().includes("interrupt")
    const assistantPartRefs = assistantMessages.flatMap((message, messageIndex) =>
      contentEntries(message)
        .filter((entry) => renderable(entry.content, showReasoning))
        .map((entry) => ({ messageID: message.id, messageIndex, partID: entry.id, content: entry.content })),
    )
    const delegating = assistantPartRefs.some(
      (entry) =>
        entry.content.type === "tool" &&
        entry.content.name === "subagent" &&
        (entry.content.state.status === "streaming" || entry.content.state.status === "running"),
    )

    if (previousUserMessage) rows.push(new TimelineRow.TurnGap({ userMessageID: turnID }))
    if (userMessage) rows.push(new TimelineRow.UserMessage({ userMessageID: turnID }))

    let assistantGroupIndex = 0
    const appendAssistants = (messages: SessionMessageAssistant[]) => {
      const ids = new Set(messages.map((message) => message.id))
      const refs = assistantPartRefs.filter((ref) => ids.has(ref.messageID))
      const interruptedAt = messages.findIndex(
        (message) =>
          message.error?.type.toLowerCase().includes("abort") ||
          message.error?.type.toLowerCase().includes("interrupt"),
      )
      const interruptedID = messages[interruptedAt]?.id
      const interruptedIndex = assistantMessages.findIndex((message) => message.id === interruptedID)
      const before = interruptedID ? refs.filter((ref) => ref.messageIndex <= interruptedIndex) : refs
      const after = interruptedID ? refs.filter((ref) => ref.messageIndex > interruptedIndex) : []
      const appendGroups = (items: typeof refs) =>
        groupContent(items).forEach((group) => {
          rows.push(
            new TimelineRow.AssistantPart({
              userMessageID: turnID,
              group,
              previousAssistantPart: assistantGroupIndex > 0,
            }),
          )
          assistantGroupIndex += 1
        })

      appendGroups(before)
      if (interruptedAt >= 0 && !compaction) rows.push(new TimelineRow.TurnDivider({ userMessageID: turnID }))
      appendGroups(after)
    }

    let assistantSegment: SessionMessageAssistant[] = []
    entries.forEach((entry) => {
      if (entry.type === "assistant") {
        assistantSegment.push(entry.message)
        return
      }
      appendAssistants(assistantSegment)
      assistantSegment = []
      rows.push(new TimelineRow.Notice({ userMessageID: turnID, messageID: entry.message.id }))
    })
    appendAssistants(assistantSegment)

    if (
      isActive &&
      status.type === "busy" &&
      !error &&
      !retry &&
      !delegating &&
      (showReasoning ? assistantPartRefs.length === 0 : true)
    ) {
      const heading = assistantMessages
        .flatMap((message) => message.content)
        .map((content) => (content.type === "reasoning" && content.text ? reasoningHeading(content.text) : undefined))
        .find((value): value is string => !!value)

      rows.push(new TimelineRow.Thinking({ userMessageID: turnID, reasoningHeading: heading }))
    }

    if (isActive && retry) rows.push(new TimelineRow.Retry({ userMessageID: turnID }))
    else if (error && !interrupted) {
      rows.push(new TimelineRow.Error({ userMessageID: turnID, text: unwrapErrorMessage(error.message) }))
    }

    return rows
  }

  export function resolveContent(message: SessionMessageInfo | undefined, partID: string): Content | undefined {
    if (message?.type !== "assistant") return undefined
    return contentEntries(message).find((entry) => entry.id === partID)?.content
  }

  export function contentEntries(message: SessionMessageAssistant) {
    const ordinals = { text: 0, reasoning: 0 }
    return message.content.map((content) => ({
      id: content.type === "tool" ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`,
      content,
    }))
  }
}

export function reuseTimelineRows(previous: TimelineRow.TimelineRow[] | undefined, rows: TimelineRow.TimelineRow[]) {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [TimelineRow.key(row), row] as const))
  const groupByPart = new Map<string, PriorGroup>()
  previous.forEach((row, index) => {
    if (row._tag !== "AssistantPart" || row.group.type === "part") return
    row.group.refs.forEach((ref) => groupByPart.set(groupPartKey(row.userMessageID, ref), { index, row }))
  })
  const reserved = new Map<string, number>()
  rows.forEach((row, index) => {
    if (row._tag !== "AssistantPart" || row.group.type === "part") return
    const key = TimelineRow.key(row)
    if (byKey.has(key) && !reserved.has(key)) reserved.set(key, index)
  })
  const claimed = new Set<string>()
  const next = rows.map((input, index) => {
    const row = stabilizeGroupKey(groupByPart, reserved, input, index, claimed)
    const existing = byKey.get(TimelineRow.key(row))
    if (!existing) return row
    return TimelineRow.equals(existing, row) ? existing : row
  })
  if (previous.length === next.length && previous.every((row, index) => row === next[index])) return previous
  return next
}

function indexUserContext(messages: SessionMessageInfo[]) {
  const result = new Map<string, { agent: string; model: ModelRef }>()
  let agent = ""
  let model: ModelRef = { id: "", providerID: "" }
  let userID: string | undefined

  messages.forEach((message) => {
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
}

function indexAssistantMessages(messages: SessionMessageInfo[]) {
  const result = new Map<string, SessionMessageAssistant[]>()
  let userID: string | undefined

  messages.forEach((message) => {
    if (message.type === "user") userID = message.id
    if (message.type === "shell") userID = undefined
    if (message.type !== "assistant" || !userID) return
    const existing = result.get(userID)
    if (existing) {
      existing.push(message)
      return
    }
    result.set(userID, [message])
  })

  return result
}

function stabilizeGroupKey(
  groupByPart: Map<string, PriorGroup>,
  reserved: Map<string, number>,
  row: TimelineRow.TimelineRow,
  rowIndex: number,
  claimed: Set<string>,
) {
  if (row._tag !== "AssistantPart" || row.group.type === "part") return row
  const existing = row.group.refs.reduce<PriorGroup | undefined>((result, ref) => {
    const candidate = groupByPart.get(groupPartKey(row.userMessageID, ref))
    if (!candidate) return result
    const key = TimelineRow.key(candidate.row)
    if (claimed.has(key)) return result
    const owner = reserved.get(key)
    if (owner !== undefined && owner !== rowIndex) return result
    return !result || candidate.index < result.index ? candidate : result
  }, undefined)
  if (!existing) return row
  const key = TimelineRow.key(existing.row)
  claimed.add(key)
  if (row.group.key === existing.row.group.key) return row
  return new TimelineRow.AssistantPart({
    userMessageID: row.userMessageID,
    previousAssistantPart: row.previousAssistantPart,
    group: { ...row.group, key: existing.row.group.key },
  })
}

function groupPartKey(userMessageID: string, ref: PartRef) {
  return `${userMessageID}:${ref.messageID}:${ref.partID}`
}

function renderable(content: Content, showReasoning: boolean) {
  if (content.type === "text") return !!content.text.trim()
  if (content.type === "reasoning") return showReasoning && !!content.text.trim()
  if (content.name === "todowrite") return false
  if (content.name === "question") return content.state.status !== "streaming" && content.state.status !== "running"
  return true
}

function groupContent(items: { messageID: string; partID: string; content: Content }[]): PartGroup[] {
  const groups: PartGroup[] = []
  let adjacent: { type: "context" | "patch" | "edit"; refs: PartRef[] } | undefined
  const flush = () => {
    const current = adjacent
    const first = current?.refs[0]
    if (!first) return
    groups.push({
      type: current.type === "context" ? "context" : "file",
      key:
        current.type !== "context"
          ? `part:${first.messageID}:${first.partID}`
          : `context:${first.messageID}:${first.partID}`,
      refs: current.refs,
    })
    adjacent = undefined
  }

  items.forEach((item) => {
    const type =
      item.content.type === "tool" && contextTools.has(item.content.name) && !hasLoadedFiles(item.content)
        ? "context"
        : item.content.type === "tool" && item.content.name === "patch" && item.content.state.status !== "error"
          ? "patch"
          : item.content.type === "tool" && item.content.name === "edit" && item.content.state.status !== "error"
            ? "edit"
            : undefined
    if (type) {
      if (adjacent?.type !== type) flush()
      adjacent ??= { type, refs: [] }
      adjacent.refs.push({ messageID: item.messageID, partID: item.partID })
      return
    }
    flush()
    groups.push({
      type: "part",
      key: `part:${item.messageID}:${item.partID}`,
      ref: { messageID: item.messageID, partID: item.partID },
    })
  })
  flush()
  return groups
}

function hasLoadedFiles(content: Extract<Content, { type: "tool" }>) {
  if (content.name !== "read" || content.state.status !== "completed") return false
  const loaded = content.state.metadata?.loaded
  return Array.isArray(loaded) && loaded.some((path) => typeof path === "string")
}

function reasoningHeading(text: string): string | undefined {
  const markdown = text.replace(/\r\n?/g, "\n")
  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = cleanHeading(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) {
    const value = cleanHeading(atx[1])
    if (value) return value
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
  if (setext?.[1]) {
    const value = cleanHeading(setext[1])
    if (value) return value
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
  if (strong?.[1]) {
    const value = cleanHeading(strong[1])
    if (value) return value
  }
  return undefined
}

function cleanHeading(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}

function unwrapErrorMessage(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()
  const parse = (value: string) => Option.getOrUndefined(decodeJson(value))
  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }

  let json = read(text)
  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) json = read(text.slice(start, end + 1))
  }
  if (!record(json)) return message

  const error = record(json.error) ? json.error : undefined
  if (error) {
    const type = typeof error.type === "string" ? error.type : undefined
    const detail = typeof error.message === "string" ? error.message : undefined
    if (type && detail) return `${type}: ${detail}`
    if (detail) return detail
    if (type) return type
    const code = typeof error.code === "string" ? error.code : undefined
    if (code) return code
  }

  const detail = typeof json.message === "string" ? json.message : undefined
  if (detail) return detail
  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason
  return message
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isNotice(message: SessionMessageInfo): message is Notice {
  if (message.type === "user" || message.type === "assistant" || message.type === "shell") return false
  if (message.type !== "synthetic") return true
  return !!message.description?.trim()
}
