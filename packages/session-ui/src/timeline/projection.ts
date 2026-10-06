import type {
  ModelRef,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
  SessionStatus,
} from "@opencode/client/promise"
import { Effect, Option, Predicate, Schema } from "effect"
import { createMemo, mapArray, type Accessor } from "solid-js"
import {
  currentContentDefaultOpen,
  currentToolFailed,
  currentToolGroupedRead,
  currentToolHasLoadedFiles,
} from "../message/current-tool-state"
import { TimelineRow, type PartGroup, type PartRef, type TimelineRowMap } from "./timeline-row"
import { timelineCategory, timelineNoticeRequired, type TimelineDetail } from "./detail"

export { TimelineRow, type PartGroup, type PartRef, type TimelineRowMap }

export type ReasoningMode = "hidden" | "compact" | "full"

type Notice = Exclude<SessionMessageInfo, { type: "user" | "assistant" | "shell" | "idle" }>

type Entry = { type: "assistant"; message: SessionMessageAssistant } | { type: "notice"; message: Notice }

type Content = SessionMessageAssistant["content"][number]

type GroupRow = Extract<TimelineRow.TimelineRow, { _tag: "AssistantPart" }>

type PriorGroup = { index: number; row: GroupRow }

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const decodeString = Schema.decodeUnknownOption(Schema.String)

// A field of the wrong type decodes as absent, so one bad field does not discard its neighbours.
function lenient<S extends Schema.Top>(schema: S) {
  return Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)))
}

const decodeLocalAgent = Schema.decodeUnknownOption(Schema.Struct({ agent: Schema.String }))

const decodeLocalModel = Schema.decodeUnknownOption(
  Schema.Struct({
    model: Schema.Struct({
      id: lenient(Schema.String),
      modelID: lenient(Schema.String),
      providerID: Schema.String,
      variant: lenient(Schema.String),
    }),
  }),
)

const decodeErrorEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.optionalKey(Schema.Unknown), message: lenient(Schema.String) }),
)

const decodeErrorDetails = Schema.decodeUnknownOption(
  Schema.Struct({ type: lenient(Schema.String), message: lenient(Schema.String), code: lenient(Schema.String) }),
)

export type TimelineProjectionInput = {
  sessionMessages: SessionMessageInfo[]
  status: SessionStatus
  reasoningMode: ReasoningMode
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  timelineDetail?: TimelineDetail
  pendingInputIDs?: ReadonlySet<string>
  queuedCompactionIDs?: readonly string[]
  previousRows?: TimelineRow.TimelineRow[]
}

export function createTimelineProjection(input: TimelineProjectionInput) {
  const sessionMessageByID = new Map(input.sessionMessages.map((message) => [message.id, message] as const))

  const projection = Timeline.constructSessionMessageRows(
    input.sessionMessages,
    input.reasoningMode !== "hidden",
    input.status,
    input.pendingInputIDs,
    input.shellToolDefaultOpen ?? false,
    input.editToolDefaultOpen ?? false,
    undefined,
    input.timelineDetail,
    input.queuedCompactionIDs,
  )

  const rows = reuseTimelineRows(input.previousRows, projection.rows)
  const rowByKey = new Map(rows.map((row) => [TimelineRow.key(row), row] as const))
  const messageRowIndex = new Map<string, number>()
  const messageLastRowIndex = new Map<string, number>()
  const lastAssistantGroupKey = new Map<string, string>()

  rows.forEach((row, index) => {
    if (!messageRowIndex.has(row.userMessageID)) messageRowIndex.set(row.userMessageID, index)
    messageLastRowIndex.set(row.userMessageID, index)

    if (Predicate.isTagged(row, "AssistantPart")) lastAssistantGroupKey.set(row.userMessageID, row.group.key)
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
  reasoningMode: Accessor<ReasoningMode>
  shellToolDefaultOpen?: Accessor<boolean>
  editToolDefaultOpen?: Accessor<boolean>
  timelineDetail?: Accessor<TimelineDetail>
  pendingInputIDs?: Accessor<ReadonlySet<string>>
  queuedCompactionIDs?: Accessor<readonly string[]>
}) {
  const sessionMessageByID = createMemo(
    () => new Map(input.sessionMessages().map((message) => [message.id, message] as const)),
  )

  const userContextByID = createMemo(() => indexUserContext(input.sessionMessages()))
  const assistantMessagesByParent = createMemo(() => indexAssistantMessages(input.sessionMessages()))

  // Row structure depends on the empty/non-empty boundary, not each text delta.
  // Keep the original content objects so row renderers still read live text.
  const textParts = mapArray(
    () =>
      input
        .sessionMessages()
        .flatMap((message) =>
          message.type === "assistant" ? message.content.filter((content) => content.type !== "tool") : [],
        ),
    (content) => [content, createMemo(() => !!content.text.trim())] as const,
  )

  const textVisible = createMemo(() => new Map<Content, Accessor<boolean>>(textParts()))

  const projection = createMemo(() =>
    Timeline.constructSessionMessageRows(
      input.sessionMessages(),
      input.reasoningMode() !== "hidden",
      input.status(),
      input.pendingInputIDs?.(),
      input.shellToolDefaultOpen?.() ?? false,
      input.editToolDefaultOpen?.() ?? false,
      (content, showReasoning, detail) =>
        content.type === "tool"
          ? renderable(content, showReasoning, detail)
          : (content.type === "text" || (detail ? detail.thinking.placement !== "hidden" : showReasoning)) &&
            textVisible().get(content)!(),
      input.timelineDetail?.(),
      input.queuedCompactionIDs?.(),
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
      if (Predicate.isTagged(row, "AssistantPart")) result.set(row.userMessageID, row.group.key)
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
    pendingInputIDs?: ReadonlySet<string>,
    shellToolDefaultOpen = false,
    editToolDefaultOpen = false,
    isRenderable = renderable,
    detail?: TimelineDetail,
    queuedCompactionIDs: readonly string[] = [],
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

    const activeMessageID = turns.findLast((turn) => !pendingInputIDs?.has(turn.id))?.id ?? turns.at(-1)?.id

    const visibleNotice = (message: Notice) =>
      !detail || detail.notices.placement !== "hidden" || timelineNoticeRequired(message)

    const visibleTurns = detail
      ? turns.filter((turn) => {
          if (turn.user) return true

          if (turn.shell && (detail.shell.placement !== "hidden" || shellFailed(turn.shell))) return true

          return turn.entries.some((entry) =>
            entry.type === "notice"
              ? visibleNotice(entry.message)
              : !!entry.message.error ||
                !!entry.message.retry ||
                entry.message.content.some((content) => isRenderable(content, showReasoning, detail)),
          )
        })
      : turns

    const rows: TimelineRow.TimelineRow[] = [
      ...leading.flatMap((message) =>
        visibleNotice(message)
          ? [new TimelineRow.Notice({ userMessageID: turns[0]?.id ?? message.id, messageID: message.id })]
          : [],
      ),
      ...visibleTurns.flatMap((turn, index) => {
        if (turn.shell)
          return [
            ...(index > 0 ? [new TimelineRow.TurnGap({ userMessageID: turn.id })] : []),
            ...(!detail || detail.shell.placement !== "hidden" || shellFailed(turn.shell)
              ? [new TimelineRow.Shell({ userMessageID: turn.id, messageID: turn.shell.id })]
              : []),
            ...turn.entries.flatMap((entry) =>
              entry.type === "notice" && visibleNotice(entry.message)
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
          shellToolDefaultOpen,
          editToolDefaultOpen,
          isRenderable,
          detail,
        )
      }),
    ]

    // Like the TUI, a queued compaction waits after the active turn and ahead of every undelivered input:
    // steers, which own turns, and synthetic notices, which ride at the end of the active one.
    const pendingAt = rows.findIndex(
      (row) =>
        pendingInputIDs?.has(row.userMessageID) ||
        (Predicate.isTagged(row, "Notice") && pendingInputIDs?.has(row.messageID)),
    )

    rows.splice(
      pendingAt < 0 ? rows.length : pendingAt,
      0,
      ...queuedCompactionIDs.map(
        (inboxID) => new TimelineRow.CompactionQueued({ userMessageID: activeMessageID ?? inboxID, inboxID }),
      ),
    )

    return {
      activeMessageID,
      rows: detail
        ? groupMessages(
            rows,
            detail,
            new Set(
              messages.flatMap((message) =>
                message.type === "compaction" ||
                message.type === "model-switched" ||
                message.type === "location-switched"
                  ? [message.id]
                  : [],
              ),
            ),
          )
        : rows,
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
    shellToolDefaultOpen = false,
    editToolDefaultOpen = false,
    isRenderable = renderable,
    detail?: TimelineDetail,
  ) {
    const rows: TimelineRow.TimelineRow[] = []
    const assistantMessages = entries.flatMap((entry) => (entry.type === "assistant" ? [entry.message] : []))
    const lastAssistant = assistantMessages.at(-1)
    const previousUserMessage = index > 0
    const compaction = entries.some((entry) => entry.type === "notice" && entry.message.type === "compaction")
    const lastContent = lastAssistant?.content.at(-1)

    const working =
      isActive &&
      status.type === "busy" &&
      lastAssistant?.time.completed === undefined &&
      !lastAssistant?.error &&
      !lastAssistant?.retry

    const thinking =
      working &&
      (detail ? detail.thinking.placement === "separate" : showReasoning) &&
      lastContent?.type === "reasoning" &&
      lastContent.time?.completed === undefined

    const thoughtOnly =
      working &&
      detail?.thinking.placement === "grouped" &&
      assistantMessages.every((message) =>
        message.content.every(
          (content) => content.type === "reasoning" || !isRenderable(content, showReasoning, detail),
        ),
      )

    if (previousUserMessage) rows.push(new TimelineRow.TurnGap({ userMessageID: turnID }))

    if (userMessage) rows.push(new TimelineRow.UserMessage({ userMessageID: turnID }))

    let assistantGroupIndex = 0
    let previousAssistantTool = false

    // An assistant message can produce several rows because its content parts are
    // rendered separately. Notices end a segment so none of those rows cross it.
    const appendAssistantSegment = (messages: SessionMessageAssistant[]) => {
      if (thoughtOnly) return

      const refs = messages.flatMap((message, messageIndex) =>
        contentEntries(message)
          .filter(
            (entry) =>
              isRenderable(entry.content, showReasoning, detail) && !(thinking && entry.content === lastContent),
          )
          .map((entry) => ({ messageID: message.id, messageIndex, partID: entry.id, content: entry.content })),
      )

      const interruptedAt = messages.findIndex((message) => isInterrupted(message.error))
      const before = interruptedAt < 0 ? refs : refs.filter((ref) => ref.messageIndex <= interruptedAt)
      const after = interruptedAt < 0 ? [] : refs.filter((ref) => ref.messageIndex > interruptedAt)

      const appendGroups = (items: typeof refs) => {
        let offset = 0
        groupContent(items, shellToolDefaultOpen, editToolDefaultOpen, detail).forEach((group) => {
          const tool = group.type !== "part" || items[offset]?.content.type !== "text"
          offset += group.type === "part" ? 1 : group.refs.length
          rows.push(
            new TimelineRow.AssistantPart({
              userMessageID: turnID,
              group,
              previousAssistantPart: assistantGroupIndex > 0,
              spacing: assistantGroupIndex > 0 ? (previousAssistantTool && tool ? "tool" : "content") : undefined,
            }),
          )
          assistantGroupIndex += 1
          previousAssistantTool = tool
        })
      }

      appendGroups(before)

      if (interruptedAt >= 0) {
        if (!compaction && detail?.notices.placement !== "hidden")
          rows.push(new TimelineRow.TurnDivider({ userMessageID: turnID }))
        appendGroups(after)
      }

      if (messages.at(-1) !== lastAssistant) return

      // The live reasoning row closes its own step, so notices that arrive meanwhile follow it.
      if (thinking && lastAssistant)
        rows.push(
          new TimelineRow.Thinking({
            userMessageID: turnID,
            ref: { messageID: lastAssistant.id, partID: contentEntries(lastAssistant).at(-1)!.id },
          }),
        )

      if (isActive && lastAssistant?.retry) rows.push(new TimelineRow.Retry({ userMessageID: turnID }))
      else if (lastAssistant?.error && !isInterrupted(lastAssistant.error))
        rows.push(
          new TimelineRow.Error({ userMessageID: turnID, text: unwrapErrorMessage(lastAssistant.error.message) }),
        )
    }

    let assistantSegment: SessionMessageAssistant[] = []
    entries.forEach((entry) => {
      switch (entry.type) {
        case "assistant":
          assistantSegment.push(entry.message)

          return
        case "notice":
          if (detail?.notices.placement === "hidden" && !timelineNoticeRequired(entry.message)) return
          appendAssistantSegment(assistantSegment)
          assistantSegment = []
          rows.push(new TimelineRow.Notice({ userMessageID: turnID, messageID: entry.message.id }))
      }
    })
    appendAssistantSegment(assistantSegment)

    return rows
  }

  export function resolveContent(message: SessionMessageInfo | undefined, partID: string): Content | undefined {
    if (message?.type !== "assistant") return undefined
    const ordinals = { text: 0, reasoning: 0 }

    for (const content of message.content) {
      const id = content.type === "tool" ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`

      if (id === partID) return content
    }
  }

  export function contentEntries(message: SessionMessageAssistant) {
    const ordinals = { text: 0, reasoning: 0 }

    return message.content.map((content) => ({
      id: content.type === "tool" ? content.id : `${message.id}:${content.type}:${ordinals[content.type]++}`,
      content,
    }))
  }
}

function isInterrupted(error: SessionMessageAssistant["error"]) {
  return error?.type.toLowerCase().includes("abort") || error?.type.toLowerCase().includes("interrupt")
}

function shellFailed(message: SessionMessageShell) {
  return (
    message.status === "timeout" || (message.status === "exited" && message.exit !== undefined && message.exit !== 0)
  )
}

function groupMessages(rows: TimelineRow.TimelineRow[], detail: TimelineDetail, separate: ReadonlySet<string>) {
  return rows.reduce<TimelineRow.TimelineRow[]>((result, row) => {
    const previous = result.at(-1)

    const current =
      ((Predicate.isTagged(row, "Notice") && detail.notices.placement === "grouped") ||
        (Predicate.isTagged(row, "Shell") && detail.shell.placement === "grouped")) &&
      !separate.has(row.messageID)
        ? new TimelineRow.AssistantPart({
            userMessageID: row.userMessageID,
            previousAssistantPart: Predicate.isTagged(previous, "AssistantPart"),
            spacing:
              Predicate.isTagged(previous, "AssistantPart") || Predicate.isTagged(previous, "Error")
                ? "tool"
                : undefined,
            group: {
              type: "context",
              key: `message:${row.messageID}`,
              refs: [{ messageID: row.messageID, partID: row.messageID }],
            },
          })
        : row

    if (
      Predicate.isTagged(previous, "AssistantPart") &&
      previous.group.type === "context" &&
      Predicate.isTagged(current, "AssistantPart") &&
      current.group.type === "context" &&
      previous.userMessageID === current.userMessageID
    ) {
      result[result.length - 1] = new TimelineRow.AssistantPart({
        ...previous,
        group: { ...previous.group, refs: [...previous.group.refs, ...current.group.refs] },
      })

      return result
    }

    result.push(current)

    return result
  }, [])
}

export function reuseTimelineRows(previous: TimelineRow.TimelineRow[] | undefined, rows: TimelineRow.TimelineRow[]) {
  if (!previous?.length) return rows
  const byKey = new Map(previous.map((row) => [TimelineRow.key(row), row] as const))
  const groupByPart = new Map<string, PriorGroup>()
  previous.forEach((row, index) => {
    if (!Predicate.isTagged(row, "AssistantPart") || row.group.type === "part") return
    row.group.refs.forEach((ref) => groupByPart.set(groupPartKey(ref), { index, row }))
  })
  const reserved = new Map<string, number>()
  rows.forEach((row, index) => {
    if (!Predicate.isTagged(row, "AssistantPart") || row.group.type === "part") return
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
      const localModel = Option.getOrUndefined(decodeLocalModel(message.metadata))?.model
      const localModelID = localModel?.id ?? localModel?.modelID

      result.set(message.id, {
        agent: Option.match(decodeLocalAgent(message.metadata), {
          onNone: () => agent,
          onSome: (local) => local.agent,
        }),
        model:
          localModel && localModelID
            ? { id: localModelID, providerID: localModel.providerID, variant: localModel.variant }
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

    if (message.type !== "assistant") return

    if (!userID) userID = message.id
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
  if (!Predicate.isTagged(row, "AssistantPart") || row.group.type === "part") return row

  const existing = row.group.refs.reduce<PriorGroup | undefined>((result, ref) => {
    const candidate = groupByPart.get(groupPartKey(ref))

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
    spacing: row.spacing,
    group: { ...row.group, key: existing.row.group.key },
  })
}

// Part refs are globally unique; keying by the turn would break reuse when a
// page-boundary turn regroups under its real user message after a history prepend.
function groupPartKey(ref: PartRef) {
  return `${ref.messageID}:${ref.partID}`
}

function renderable(content: Content, showReasoning: boolean, detail?: TimelineDetail) {
  if (content.type === "text") return !!content.text.trim()

  if (content.type === "reasoning")
    return (detail ? detail.thinking.placement !== "hidden" : showReasoning) && !!content.text.trim()

  if (detail && currentToolFailed(content)) return true

  if (content.name === "todowrite") return false

  if (content.name === "question") return content.state.status !== "streaming" && content.state.status !== "running"

  if (detail && detail[timelineCategory(content)!].placement === "hidden") return false

  return true
}

function groupContent(
  items: { messageID: string; partID: string; content: Content }[],
  shellToolDefaultOpen: boolean,
  editToolDefaultOpen: boolean,
  detail?: TimelineDetail,
): PartGroup[] {
  const groups: PartGroup[] = []
  let adjacent: { type: "context" | "file" | "read"; refs: PartRef[]; tools: boolean } | undefined

  const flush = () => {
    const current = adjacent
    const first = current?.refs[0]

    if (!first) return

    if (!current.tools && !detail) {
      groups.push(
        ...current.refs.map((ref) => ({ type: "part" as const, key: `part:${ref.messageID}:${ref.partID}`, ref })),
      )
      adjacent = undefined

      return
    }

    groups.push({
      type: current.type,
      key:
        current.type !== "context"
          ? `part:${first.messageID}:${first.partID}`
          : `context:${first.messageID}:${first.partID}`,
      refs: current.refs,
    })
    adjacent = undefined
  }

  items.forEach((item) => {
    const type = contentGroupType(
      item.content,
      shellToolDefaultOpen,
      editToolDefaultOpen,
      adjacent?.type === "context" && adjacent.tools,
      detail,
    )

    if (type) {
      if (adjacent?.type !== type) flush()
      adjacent ??= { type, refs: [], tools: false }
      adjacent.tools ||= item.content.type === "tool"
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

function contentGroupType(
  content: Content,
  shellExpanded: boolean,
  editExpanded: boolean,
  hasContextGroup: boolean,
  detail?: TimelineDetail,
) {
  if (content.type === "tool") return toolGroupType(content, shellExpanded, editExpanded, hasContextGroup, detail)

  if (content.type !== "reasoning") return undefined

  return detail && detail.thinking.placement !== "grouped" ? undefined : "context"
}

function toolGroupType(
  content: Extract<Content, { type: "tool" }>,
  shellExpanded: boolean,
  editExpanded: boolean,
  hasContextGroup: boolean,
  detail?: TimelineDetail,
) {
  if (detail) {
    if (content.name === "question" && !currentToolFailed(content)) return undefined
    const category = timelineCategory(content)!

    if (detail[category].placement === "grouped") return "context"

    if (currentToolGroupedRead(content)) return "read"

    if (currentToolFailed(content)) return undefined

    if (content.name === "patch" || content.name === "edit" || content.name === "write") return "file"

    return undefined
  }

  if (content.name === "question" || currentToolHasLoadedFiles(content)) return undefined

  if (content.state.status === "error") {
    if ((content.name === "shell" || content.name === "execute") && shellExpanded) return undefined

    if ((content.name === "edit" || content.name === "write" || content.name === "patch") && editExpanded)
      return undefined

    return "context"
  }

  if (
    !hasContextGroup &&
    (content.state.status !== "completed" ||
      ("metadata" in content.state && content.state.metadata?.status === "running")) &&
    (content.name === "shell" || content.name === "execute" || content.name === "subagent")
  )
    return undefined

  if (currentContentDefaultOpen(content, shellExpanded, editExpanded) !== true) return "context"

  if (content.name === "patch" || content.name === "edit" || content.name === "write") return "file"

  return undefined
}

export function reasoningHeading(text: string): string | undefined {
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

export function unwrapErrorMessage(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()
  const parse = (value: string) => Option.getOrUndefined(decodeJson(value))

  // A JSON string that itself holds JSON is unwrapped once.
  const read = (value: string) => {
    const first = parse(value)

    return Option.match(decodeString(first), { onNone: () => first, onSome: (inner) => parse(inner.trim()) })
  }

  const whole = read(text)
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  const json = whole === undefined && start !== -1 && end > start ? read(text.slice(start, end + 1)) : whole
  const envelope = Option.getOrUndefined(decodeErrorEnvelope(json))

  if (!envelope) return message
  const error = Option.getOrUndefined(decodeErrorDetails(envelope.error))

  if (error?.type && error.message) return `${error.type}: ${error.message}`

  if (error?.message) return error.message

  if (error?.type) return error.type

  if (error?.code) return error.code

  if (envelope.message) return envelope.message

  return Option.getOrUndefined(decodeString(envelope.error)) || message
}

function isNotice(message: SessionMessageInfo): message is Notice {
  if (message.type === "user" || message.type === "assistant" || message.type === "shell" || message.type === "idle")
    return false

  if (message.type !== "synthetic") return true

  return !!message.description?.trim() || timelineNoticeRequired(message)
}
