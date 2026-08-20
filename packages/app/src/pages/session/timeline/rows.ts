import { parseCommentNote, readPromptPresentation } from "@/utils/comment-note"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
  SessionStatus,
} from "@opencode-ai/client/promise"
import type { PartGroup } from "@opencode-ai/session-ui/message-part"
import { TimelineRow } from "./timeline-row"

export { TimelineRow } from "./timeline-row"

export type TimelineRowMap = {
  TurnGap: { userMessageID: string }
  UserMessage: {
    userMessageID: string
  }
  Shell: { userMessageID: string; messageID: string }
  Notice: { userMessageID: string; messageID: string }
  TurnDivider: {
    userMessageID: string
  }
  AssistantPart: {
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
  }
  Thinking: { userMessageID: string; reasoningHeading?: string }
  Retry: { userMessageID: string }
  Error: { userMessageID: string; text: string }
}

type Assistant = SessionMessageAssistant
type Notice = Exclude<SessionMessageInfo, { type: "user" | "assistant" | "shell" }>
type Entry = { type: "assistant"; message: Assistant } | { type: "notice"; message: Notice }
type Content = Assistant["content"][number]
type ContentRef = { messageID: string; partID: string }

const contextTools = new Set(["read", "glob", "grep", "list"])

export namespace Timeline {
  export function constructSessionMessageRows(
    messages: SessionMessageInfo[],
    showReasoning: boolean,
    status: SessionStatus["type"],
  ) {
    type Turn = {
      id: string
      time: { created: number }
      user?: SessionMessageUser
      shell?: SessionMessageShell
      entries: Entry[]
    }
    const turns: Turn[] = []
    const turnByUserID = new Map<string, (typeof turns)[number]>()
    const leading: Notice[] = []
    let current: (typeof turns)[number] | undefined
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
    status: SessionStatus["type"],
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
    if (previousUserMessage) rows.push(new TimelineRow.TurnGap({ userMessageID: turnID }))

    if (userMessage) rows.push(new TimelineRow.UserMessage({ userMessageID: turnID }))

    let assistantGroupIndex = 0
    const appendAssistants = (messages: Assistant[]) => {
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
    let assistantSegment: Assistant[] = []
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

    if (isActive && status === "busy" && !error && !retry && (showReasoning ? assistantPartRefs.length === 0 : true)) {
      const heading = assistantMessages
        .flatMap((message) => message.content)
        .map((content) => (content.type === "reasoning" && content.text ? reasoningHeading(content.text) : undefined))
        .find((value): value is string => !!value)

      rows.push(
        new TimelineRow.Thinking({
          userMessageID: turnID,
          reasoningHeading: heading,
        }),
      )
    }

    if (isActive && retry) rows.push(new TimelineRow.Retry({ userMessageID: turnID }))

    if (error && !interrupted) {
      rows.push(
        new TimelineRow.Error({
          userMessageID: turnID,
          text: unwrapErrorMessage(error.message),
        }),
      )
    }

    return rows
  }

  export function resolveContent(message: SessionMessageInfo | undefined, partID: string) {
    if (message?.type !== "assistant") return
    return contentEntries(message).find((entry) => entry.id === partID)?.content
  }

  export function contentEntries(message: Assistant) {
    const ordinals = { text: 0, reasoning: 0 }
    return message.content.map((content) => ({
      id: content.type === "tool" ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`,
      content,
    }))
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
    let context: ContentRef[] = []
    const flush = () => {
      const first = context[0]
      if (!first) return
      groups.push({ type: "context", key: `context:${first.partID}`, refs: context })
      context = []
    }
    items.forEach((item) => {
      if (item.content.type === "tool" && contextTools.has(item.content.name)) {
        context.push({ messageID: item.messageID, partID: item.partID })
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

  function reasoningHeading(text: string) {
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

    const parse = (value: string) => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return undefined
      }
    }

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

    const err = record(json.error) ? json.error : undefined
    if (err) {
      const type = typeof err.type === "string" ? err.type : undefined
      const msg = typeof err.message === "string" ? err.message : undefined
      if (type && msg) return `${type}: ${msg}`
      if (msg) return msg
      if (type) return type
      const code = typeof err.code === "string" ? err.code : undefined
      if (code) return code
    }

    const msg = typeof json.message === "string" ? json.message : undefined
    if (msg) return msg

    const reason = typeof json.error === "string" ? json.error : undefined
    if (reason) return reason

    return message
  }

  function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }

  function isNotice(
    message: SessionMessageInfo,
  ): message is Exclude<SessionMessageInfo, { type: "user" | "assistant" | "shell" }> {
    if (message.type === "user" || message.type === "assistant" || message.type === "shell") return false
    if (message.type !== "synthetic") return true
    return !!message.description?.trim()
  }
}

export namespace MessageComment {
  export type MessageComment = {
    path: string
    comment: string
    selection?: {
      startLine: number
      endLine: number
    }
  }

  export const fromMessage = (message: SessionMessageUser): MessageComment[] => {
    const presentation = readPromptPresentation(message.metadata)
    const parsed = presentation ? undefined : parseCommentNote(message.text)
    const comments = presentation?.comments ?? (parsed ? [parsed] : [])
    return comments.map((comment) => ({
      path: comment.path,
      comment: comment.comment,
      selection: comment.selection
        ? { startLine: comment.selection.startLine, endLine: comment.selection.endLine }
        : undefined,
    }))
  }
}
