import type {
  ModelRef,
  SessionMessageAssistant,
  SessionMessageIdle,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
  SessionStatus,
} from "@opencode/client/promise"
import { Effect, Option, Predicate, Schema } from "effect"
import { createComputed, createMemo, createSignal, mapArray, type Accessor } from "solid-js"
import { currentToolFailed, currentToolGroupedRead } from "../message/current-tool-state"
import { TimelineRow, type PartGroup, type PartRef, type TimelineRowMap } from "./timeline-row"
import { defaultTimelineDetail, type TimelineDetail } from "./detail"
import {
  timelineCategory,
  timelineNoticePlacement,
  timelineNoticeRequired,
  timelineRenders,
  timelineHidesActivity,
  timelineTextShows,
  shellFailed,
} from "./policy"
import { errorInfo } from "./errors"
import { noticeEvent, timelineEventTool } from "./events"
import { timelineGaps, type TimelineGap } from "./spacing"
import {
  IDLE_TURN_PHASE,
  isInterruptedError,
  sameTurnPhase,
  transitionTurnPhase,
  viewTurnPhase,
  type TurnPhase,
  type TurnPhaseEvent,
  type TurnThinkingPlacement,
} from "./turn-phase-machine"

export { TimelineRow, type PartGroup, type PartRef, type TimelineRowMap, type TurnPhase }
export { reasoningHeading } from "./heading"
export { unwrapErrorMessage } from "./errors"

type Notice = Exclude<SessionMessageInfo, { type: "user" | "assistant" | "shell" | "idle" }>

type FailedIdle = SessionMessageIdle & {
  outcome: "failed"
  error: NonNullable<SessionMessageIdle["error"]>
}

type Entry =
  | { type: "assistant"; message: SessionMessageAssistant }
  | { type: "notice"; message: Notice }
  | { type: "idle"; message: FailedIdle }
  | { type: "diff"; message: SessionMessageIdle; from: string; files: string[] }

type Content = SessionMessageAssistant["content"][number]

type GroupRow = Extract<TimelineRow.TimelineRow, { _tag: "AssistantPart" }>

type PriorGroup = { index: number; row: GroupRow }

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

export type TimelineProjectionInput = {
  sessionMessages: SessionMessageInfo[]
  status: SessionStatus
  /** Defaults to the Compact preset. */
  timelineDetail?: TimelineDetail
  pendingInputIDs?: ReadonlySet<string>
  queuedCompactionIDs?: readonly string[]
  turnDiffs?: boolean
  /** The Activity timeline experiment. */
  activity?: boolean
  previousRows?: TimelineRow.TimelineRow[]
}

export function createTimelineProjection(input: TimelineProjectionInput) {
  const sessionMessageByID = new Map(input.sessionMessages.map((message) => [message.id, message] as const))

  const projection = Timeline.constructSessionMessageRows(
    input.sessionMessages,
    input.status,
    input.timelineDetail ?? defaultTimelineDetail,
    input.pendingInputIDs,
    input.queuedCompactionIDs,
    input.turnDiffs,
    input.activity,
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
    turnPhaseByID: projection.turnPhaseByID,
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
  /** Defaults to the Compact preset. */
  timelineDetail?: Accessor<TimelineDetail>
  pendingInputIDs?: Accessor<ReadonlySet<string>>
  queuedCompactionIDs?: Accessor<readonly string[]>
  /** Summarize each finished turn's changed files after it. */
  turnDiffs?: Accessor<boolean>
  /** The Activity timeline experiment. */
  activity?: Accessor<boolean>
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
    (content) => {
      // A memo here went stale on every streamed delta, which marked the projection below pending; Solid then
      // re-checked each of its thousands of sources to find nothing changed. A signal set from a computation
      // notifies only when visibility actually flips.
      const [visible, setVisible] = createSignal(false)
      createComputed(() => setVisible(timelineTextShows(content, !!input.activity?.())))

      return [content, visible] as const
    },
  )

  const textVisible = createMemo(() => new Map<Content, Accessor<boolean>>(textParts()))

  const projection = createMemo(() =>
    Timeline.constructSessionMessageRows(
      input.sessionMessages(),
      input.status(),
      input.timelineDetail?.() ?? defaultTimelineDetail,
      input.pendingInputIDs?.(),
      input.queuedCompactionIDs?.(),
      input.turnDiffs?.(),
      input.activity?.(),
      (detail, content, activity) =>
        content.type === "tool"
          ? timelineRenders(detail, content, activity)
          : (content.type === "text" || detail.thinking.placement !== "hidden") && textVisible().get(content)!(),
    ),
  )

  const activeMessageID = createMemo(() => projection().activeMessageID)

  // Rows read their turn's phase, so a recomputed projection that leaves every phase as it was notifies none of them.
  const turnPhaseByID = createMemo(() => projection().turnPhaseByID, undefined, {
    equals: (previous, next) =>
      previous.size === next.size &&
      [...next].every(([id, phase]) => {
        const prior = previous.get(id)

        return !!prior && sameTurnPhase(prior, phase)
      }),
  })

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

  // The Activity timeline spaces rows by block; other timelines keep each row's own spacing.
  const rowGaps = createMemo(() =>
    input.activity?.() ? timelineGaps(rows(), sessionMessageByID()) : new Map<string, TimelineGap>(),
  )

  return {
    activeMessageID,
    turnPhaseByID,
    assistantMessagesByParent,
    lastAssistantGroupKey,
    rowGaps,
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
    status: SessionStatus,
    detail: TimelineDetail,
    pendingInputIDs?: ReadonlySet<string>,
    queuedCompactionIDs: readonly string[] = [],
    turnDiffs = false,
    activity = false,
    isRenderable = timelineRenders,
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
    // Everything since the last idle marker is one turn, including prompts steered in meanwhile.
    let execution: { opener: string; turn: Turn; files: Set<string> } | undefined

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

        // Undelivered input has not joined the turn yet.
        if (!pendingInputIDs?.has(message.id))
          execution = { opener: execution?.opener ?? message.id, turn, files: execution?.files ?? new Set() }

        return
      }

      if (message.type === "idle") {
        appendIdle(message)

        // The summary follows the turn's last prompt, after any failure the marker reports.
        // Sorted like the diff route's git order, so the list keeps its order when the diffs arrive.
        if (turnDiffs && execution?.files.size)
          execution.turn.entries.push({
            type: "diff",
            message,
            from: execution.opener,
            files: [...execution.files].sort(),
          })
        execution = undefined

        return
      }

      if (message.type !== "assistant") return
      message.snapshot?.files?.forEach((file) => execution?.files.add(file))
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

    function appendIdle(message: SessionMessageIdle) {
      if (!isFailedIdle(message)) return
      const last = current?.entries.at(-1)

      if (
        last?.type === "notice" &&
        last.message.type === "compaction" &&
        last.message.status === "failed" &&
        !isInterruptedError(last.message.error)
      )
        return

      const lastStep = current?.entries.findLast((entry) => entry.type === "assistant" || entry.type === "idle")

      if (lastStep?.type === "assistant" && lastStep.message.error && !isInterruptedError(lastStep.message.error))
        return

      if (current && !current.shell) {
        current.entries.push({ type: "idle", message })

        return
      }

      const turn: Turn = { id: message.id, time: message.time, entries: [{ type: "idle", message }] }
      turns.push(turn)
      current = turn
    }

    const activeMessageID =
      turns.findLast((turn) => !pendingInputIDs?.has(turn.id) || turn.entries.some((entry) => entry.type === "idle"))
        ?.id ?? turns.at(-1)?.id

    // In the Activity timeline, the thought the model is writing stands at the end of the turn in place of the status
    // line, wherever thinking shows. Once finished, it settles where the setting puts thoughts.
    const livePlacement = activity && detail.thinking.placement !== "hidden" ? "separate" : detail.thinking.placement

    const turnPhaseByID = new Map(
      turns.map(
        (turn) => [turn.id, turnPhase(turn.entries, turn.id === activeMessageID, status, livePlacement)] as const,
      ),
    )

    const phaseOf = (turn: Turn) => turnPhaseByID.get(turn.id) ?? IDLE_TURN_PHASE

    const commentary = new Set(
      detail.commentary.placement !== "separate"
        ? turns.flatMap((turn) =>
            turnCommentary(turn.entries, viewTurnPhase(phaseOf(turn)).settled, (content) =>
              isRenderable(detail, content, activity),
            ),
          )
        : [],
    )

    const visible = (content: Content) =>
      !(detail.commentary.placement === "hidden" && commentary.has(content)) && isRenderable(detail, content, activity)

    const visibleNotice = (message: Notice) => timelineNoticePlacement(detail, message, activity) !== "hidden"
    const visibleShell = (shell: SessionMessageShell) =>
      activity || detail.shell.placement !== "hidden" || shellFailed(shell)

    const visibleTurns = turns.filter((turn) => {
      if (turn.user) return true

      // In the Activity timeline a command the user ran shows at every setting, as their messages do.
      if (turn.shell && visibleShell(turn.shell)) return true

      return turn.entries.some((entry) =>
        entry.type === "notice"
          ? visibleNotice(entry.message)
          : entry.type === "idle" ||
            entry.type === "diff" ||
            !!entry.message.error ||
            !!entry.message.retry ||
            entry.message.content.some(visible),
      )
    })

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
            ...(visibleShell(turn.shell)
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
          phaseOf(turn),
          detail,
          visible,
          commentary,
          activity,
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
      // Live status ends the work the model has seen, so it stays above everything still waiting for delivery.
      ...(status.type !== "idle" && activeMessageID && (pendingAt >= 0 || queuedCompactionIDs.length > 0)
        ? [new TimelineRow.Activity({ userMessageID: activeMessageID })]
        : []),
      ...queuedCompactionIDs.map(
        (inboxID) => new TimelineRow.CompactionQueued({ userMessageID: activeMessageID ?? inboxID, inboxID }),
      ),
    )

    const grouped = groupMessages(
      rows,
      detail,
      new Set(
        messages.flatMap((message) =>
          timelineNoticePlacement(detail, message, activity) === "separate" ||
          (!activity &&
            (message.type === "compaction" ||
              message.type === "model-switched" ||
              message.type === "location-switched"))
            ? [message.id]
            : [],
        ),
      ),
      activity,
    )

    return {
      activeMessageID,
      turnPhaseByID,
      rows: activity
        ? mergeBackgroundEvents(grouped, new Map(messages.map((message) => [message.id, message])))
        : grouped,
    }
  }

  export function constructMessageRows(
    userMessage: SessionMessageUser | undefined,
    turnID: string,
    entries: Entry[],
    index: number,
    phase: TurnPhase,
    detail: TimelineDetail,
    isVisible: (content: Content) => boolean,
    commentary: ReadonlySet<Content> = new Set(),
    activity = false,
  ) {
    const rows: TimelineRow.TimelineRow[] = []
    const assistantMessages = entries.flatMap((entry) => (entry.type === "assistant" ? [entry.message] : []))
    const lastAssistant = assistantMessages.at(-1)
    const lastStep = entries.findLast((entry) => entry.type === "assistant" || entry.type === "idle")
    const previousUserMessage = index > 0
    const view = viewTurnPhase(phase)
    const thinking = view.separateThinkingRef

    if (previousUserMessage) rows.push(new TimelineRow.TurnGap({ userMessageID: turnID }))

    if (userMessage) rows.push(new TimelineRow.UserMessage({ userMessageID: turnID }))

    const compaction = entries.some((entry) => entry.type === "notice" && entry.message.type === "compaction")
    let assistantGroupIndex = 0
    let previousAssistantTool = false

    // An assistant message can produce several rows because its content parts are
    // rendered separately. Notices end a segment so none of those rows cross it.
    const appendAssistantSegment = (messages: SessionMessageAssistant[]) => {
      const refs = messages.flatMap((message, messageIndex) =>
        contentEntries(message)
          .filter(
            (entry) =>
              isVisible(entry.content) && !(thinking?.messageID === message.id && thinking.partID === entry.id),
          )
          .map((entry) => ({ messageID: message.id, messageIndex, partID: entry.id, content: entry.content })),
      )

      const interruptedAt = messages.findIndex((message) => isInterruptedError(message.error))
      const before = interruptedAt < 0 ? refs : refs.filter((ref) => ref.messageIndex <= interruptedAt)
      const after = interruptedAt < 0 ? [] : refs.filter((ref) => ref.messageIndex > interruptedAt)

      const appendGroups = (items: typeof refs) => {
        let offset = 0
        groupContent(items, commentary, detail, activity).forEach((group) => {
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

      // In the Activity timeline the user stopped the turn, so the timeline confirms it at every setting.
      if (interruptedAt >= 0) {
        if (activity || (!compaction && detail.notices.placement !== "hidden"))
          rows.push(new TimelineRow.TurnDivider({ userMessageID: turnID }))
        appendGroups(after)
      }

      if (messages.at(-1) !== lastAssistant) return

      // The live reasoning row closes its own step, so notices that arrive meanwhile follow it.
      // In the Activity timeline the live thought takes the space the row it settles into will, so it does not move.
      if (thinking)
        rows.push(
          new TimelineRow.Thinking({
            userMessageID: turnID,
            ref: thinking,
            spacing: activity ? nextRowSpacing(assistantGroupIndex, previousAssistantTool) : undefined,
          }),
        )

      if (lastStep?.type !== "assistant") return

      if (view.retry)
        rows.push(
          new TimelineRow.Retry({
            userMessageID: turnID,
            attempt: view.retry.attempt,
            message: view.retry.message,
            next: view.retry.next,
          }),
        )

      if (view.error) rows.push(new TimelineRow.Error({ userMessageID: turnID, ...view.error }))
    }

    let assistantSegment: SessionMessageAssistant[] = []
    entries.forEach((entry) => {
      switch (entry.type) {
        case "assistant":
          assistantSegment.push(entry.message)

          return
        case "idle":
          appendAssistantSegment(assistantSegment)
          assistantSegment = []

          if (entry === lastStep && view.error)
            rows.push(new TimelineRow.Error({ userMessageID: turnID, ...view.error }))

          return
        case "diff":
          appendAssistantSegment(assistantSegment)
          assistantSegment = []
          rows.push(
            new TimelineRow.TurnDiff({
              userMessageID: turnID,
              messageID: entry.message.id,
              from: entry.from,
              files: entry.files,
            }),
          )

          return
        case "notice":
          if (timelineNoticePlacement(detail, entry.message) === "hidden") return
          appendAssistantSegment(assistantSegment)
          assistantSegment = []
          rows.push(new TimelineRow.Notice({ userMessageID: turnID, messageID: entry.message.id }))
      }
    })
    appendAssistantSegment(assistantSegment)

    // Where the setting hides all of the agent's activity, a turn the user stopped says how long it worked.
    if (
      activity &&
      timelineHidesActivity(detail) &&
      assistantMessages.some((message) => isInterruptedError(message.error))
    )
      rows.push(new TimelineRow.Worked({ userMessageID: turnID }))

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

// Each step replaces the phase the steps before it left, so the turn ends in the phase of its last step.
function turnPhase(entries: Entry[], active: boolean, status: SessionStatus, placement: TurnThinkingPlacement) {
  return entries.reduce(
    (phase, entry) => {
      if (entry.type === "idle")
        return transitionTurnPhase(phase, { type: "idle.failed", error: errorInfo(entry.message) })

      if (entry.type !== "assistant") return phase

      return transitionTurnPhase(phase, stepEvent(entry.message, active, status, placement))
    },
    transitionTurnPhase(IDLE_TURN_PHASE, { type: "started", live: active && status.type !== "idle" }),
  )
}

function stepEvent(
  message: SessionMessageAssistant,
  active: boolean,
  status: SessionStatus,
  placement: TurnThinkingPlacement,
): TurnPhaseEvent {
  const completed = message.time.completed !== undefined
  const last = !completed && active ? Timeline.contentEntries(message).at(-1) : undefined

  return {
    type: "step",
    active,
    session: status.type,
    completed,
    reasoning:
      last?.content.type === "reasoning" && last.content.time?.completed === undefined
        ? { ref: { messageID: message.id, partID: last.id }, placement }
        : undefined,
    retry: message.retry
      ? { attempt: message.retry.attempt, message: message.retry.error.message, next: message.retry.at }
      : undefined,
    error: !message.error
      ? undefined
      : isInterruptedError(message.error)
        ? { interrupted: true }
        : { interrupted: false, info: errorInfo(message) },
  }
}

function isFailedIdle(message: SessionMessageInfo): message is FailedIdle {
  return message.type === "idle" && message.outcome === "failed" && !!message.error
}

// Text that a tool call follows in the same turn is commentary; text after the last tool call is the answer.
// OpenAI Responses models label each message with a phase, which wins over position. A settled turn
// without an answer keeps its last text, so an interrupted turn still ends with something to read.
function turnCommentary(entries: Entry[], settled: boolean, visible: (content: Content) => boolean) {
  const contents = entries.flatMap((entry) => (entry.type === "assistant" ? entry.message.content : []))
  const lastTool = contents.findLastIndex((content) => content.type === "tool")

  const commentary = contents.filter(
    (content, index) =>
      content.type === "text" &&
      (content.native?.phase === "commentary" || (content.native?.phase !== "final_answer" && index < lastTool)),
  )

  const texts = contents.filter((content) => content.type === "text" && visible(content))

  if (!settled || texts.some((content) => !commentary.includes(content))) return commentary

  return commentary.filter((content) => content !== texts.at(-1))
}

function groupMessages(
  rows: TimelineRow.TimelineRow[],
  detail: TimelineDetail,
  separate: ReadonlySet<string>,
  activity: boolean,
) {
  return rows.reduce<TimelineRow.TimelineRow[]>((result, row) => {
    const previous = result.at(-1)
    // Live status renders nothing while other feedback shows, so a group below it spaces from the content above it.
    const above = Predicate.isTagged(previous, "Activity") ? result.at(-2) : previous

    const current =
      ((Predicate.isTagged(row, "Notice") && detail.notices.placement === "grouped") ||
        (!activity && Predicate.isTagged(row, "Shell") && detail.shell.placement === "grouped")) &&
      !separate.has(row.messageID)
        ? new TimelineRow.AssistantPart({
            userMessageID: row.userMessageID,
            previousAssistantPart: Predicate.isTagged(above, "AssistantPart"),
            spacing:
              Predicate.isTagged(above, "AssistantPart") || Predicate.isTagged(above, "Error") ? "tool" : undefined,
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

/** The space above the next row of activity in a turn: none as its first, a little after activity, more after text. */
export function nextRowSpacing(index: number, previousTool: boolean) {
  if (index === 0) return undefined

  return previousTool ? ("tool" as const) : ("content" as const)
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

type UserSelection = { agent: string; model: ModelRef }

/** The agent and model a user message's metadata names, when it names them. */
function localSelection(message: SessionMessageUser): Partial<UserSelection> {
  const localModel = Option.getOrUndefined(decodeLocalModel(message.metadata))?.model
  const localModelID = localModel?.id ?? localModel?.modelID

  return {
    agent: Option.getOrUndefined(decodeLocalAgent(message.metadata))?.agent,
    model:
      localModel && localModelID
        ? { id: localModelID, providerID: localModel.providerID, variant: localModel.variant }
        : undefined,
  }
}

function indexUserContext(messages: SessionMessageInfo[]) {
  const result = new Map<string, UserSelection>()
  let agent = ""
  let model: ModelRef = { id: "", providerID: "" }
  let userID: string | undefined

  messages.forEach((message) => {
    if (message.type === "agent-switched") agent = message.agent

    if (message.type === "model-switched") model = message.model

    if (message.type === "user") {
      userID = message.id
      const local = localSelection(message)
      result.set(message.id, { agent: local.agent ?? agent, model: local.model ?? model })
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

/**
 * In the Activity timeline, background subagents and shells that report back one after another read as one row:
 * "Finished 2 subagents". Anything else between them keeps them apart, so the order of events stays true.
 */
function mergeBackgroundEvents(
  rows: TimelineRow.TimelineRow[],
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
): TimelineRow.TimelineRow[] {
  return rows.reduce<TimelineRow.TimelineRow[]>((result, row) => {
    const message = Predicate.isTagged(row, "Notice") ? messageByID.get(row.messageID) : undefined

    if (!Predicate.isTagged(row, "Notice") || !message || !noticeEvent(message)) {
      result.push(row)

      return result
    }
    const previous = result.at(-1)

    if (Predicate.isTagged(previous, "BackgroundEvents") && previous.userMessageID === row.userMessageID) {
      result[result.length - 1] = new TimelineRow.BackgroundEvents({
        userMessageID: row.userMessageID,
        messageIDs: [...previous.messageIDs, row.messageID],
      })

      return result
    }

    result.push(new TimelineRow.BackgroundEvents({ userMessageID: row.userMessageID, messageIDs: [row.messageID] }))

    return result
  }, [])
}

function groupContent(
  items: { messageID: string; partID: string; content: Content }[],
  commentary: ReadonlySet<Content>,
  detail: TimelineDetail,
  activity = false,
): PartGroup[] {
  const groups: PartGroup[] = []
  let adjacent: { type: "context" | "file" | "read" | "events"; refs: PartRef[] } | undefined

  const flush = () => {
    const current = adjacent
    const first = current?.refs[0]

    if (!first) return

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
    // In the Activity timeline subagents and background shells read as events, counted together however they run.
    const type =
      activity && item.content.type === "tool" && timelineEventTool(item.content)
        ? "events"
        : contentGroupType(item.content, commentary, detail, activity)

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

function contentGroupType(
  content: Content,
  commentary: ReadonlySet<Content>,
  detail: TimelineDetail,
  activity: boolean,
) {
  if (content.type === "tool") return toolGroupType(content, detail, activity)

  if (content.type === "text") return commentary.has(content) ? "context" : undefined

  return detail.thinking.placement !== "grouped" ? undefined : "context"
}

function toolGroupType(content: Extract<Content, { type: "tool" }>, detail: TimelineDetail, activity: boolean) {
  if (content.name === "question" && !currentToolFailed(content)) return undefined

  if (detail[timelineCategory(content)!].placement === "grouped") return "context"

  if (currentToolGroupedRead(content)) return "read"

  if (currentToolFailed(content)) return undefined

  if (activity ? timelineCategory(content) === "edit" : ["patch", "edit", "write"].includes(content.name)) return "file"

  return undefined
}

function isNotice(message: SessionMessageInfo): message is Notice {
  if (message.type === "user" || message.type === "assistant" || message.type === "shell" || message.type === "idle")
    return false

  if (message.type !== "synthetic") return true

  return !!message.description?.trim() || timelineNoticeRequired(message)
}
