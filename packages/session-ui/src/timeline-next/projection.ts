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
import { timelineNoticeRequired, type TimelineDetail } from "../timeline/detail"
import { TimelineRow, type PartGroup, type PartRef } from "../timeline/timeline-row"
import {
  IDLE_TURN_PHASE,
  isInterruptedError,
  sameTurnPhase,
  transitionTurnPhase,
  viewTurnPhase,
  type TurnPhase,
  type TurnPhaseEvent,
  type TurnThinkingPlacement,
} from "../timeline/turn-phase-machine"
import { errorInfo } from "./errors"
import { noticeEvent, toolEvent, workKey, type TimelineEvent } from "./events"
import {
  contentGroup,
  contentShows,
  echoesUserShell,
  hidesActivity,
  liveThinkingShows,
  noticePlacement,
  textShows,
  toolRule,
} from "./rules"

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

type Turn = {
  id: string
  time: { created: number }
  user?: SessionMessageUser
  shell?: SessionMessageShell
  entries: Entry[]
}

type Content = SessionMessageAssistant["content"][number]

type GroupRow = Extract<TimelineRow.TimelineRow, { _tag: "AssistantPart" }>

type PriorGroup = { index: number; row: GroupRow }

/** Everything the projection reads to build the New timeline's rows. */
type Input = {
  messages: SessionMessageInfo[]
  status: SessionStatus
  detail: TimelineDetail
  pendingInputIDs?: ReadonlySet<string>
  queuedCompactionIDs: readonly string[]
  turnDiffs: boolean
  /** Whether a part shows. Text and thoughts are read through signals, so a streamed delta does not rebuild the rows. */
  shows: (content: Content) => boolean
}

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

/**
 * The New timeline's rows. It returns the same shape as the current timeline's projection, so the app scrolls, searches
 * and reveals either the same way.
 */
export function createNextTimelineProjection(input: {
  sessionMessages: Accessor<SessionMessageInfo[]>
  status: Accessor<SessionStatus>
  timelineDetail: Accessor<TimelineDetail>
  pendingInputIDs?: Accessor<ReadonlySet<string>>
  queuedCompactionIDs?: Accessor<readonly string[]>
  /** Summarize each finished turn's changed files after it. */
  turnDiffs?: Accessor<boolean>
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
      createComputed(() => setVisible(textShows(content)))

      return [content, visible] as const
    },
  )

  const textVisible = createMemo(() => new Map<Content, Accessor<boolean>>(textParts()))

  const projection = createMemo(() => {
    const detail = input.timelineDetail()

    return constructRows({
      messages: input.sessionMessages(),
      status: input.status(),
      detail,
      pendingInputIDs: input.pendingInputIDs?.(),
      queuedCompactionIDs: input.queuedCompactionIDs?.() ?? [],
      turnDiffs: input.turnDiffs?.() ?? false,
      shows: (content) =>
        content.type === "tool"
          ? contentShows(detail, content)
          : (content.type === "text" || detail.thinking.placement !== "hidden") && textVisible().get(content)!(),
    })
  })

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

  return {
    activeMessageID,
    turnPhaseByID,
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

/**
 * How long a turn the user stopped worked: from its start, the user's message or else the agent's first step, to the end
 * of the step the user stopped. A stopped step may not record its end, so its parts' latest time stands in.
 */
export function workedDuration(user: SessionMessageUser | undefined, steps: readonly SessionMessageAssistant[]) {
  const start = user?.time.created ?? steps[0]?.time.created
  const stopped = steps.find((step) => isInterruptedError(step.error))

  if (start === undefined || !stopped) return undefined

  const end =
    stopped.time.completed ??
    Math.max(
      stopped.time.created,
      ...stopped.content.flatMap((content) =>
        content.type === "text" ? [] : [content.time?.completed ?? content.time?.created ?? stopped.time.created],
      ),
    )

  return Math.max(0, end - start)
}

/** A part of an assistant message by its ID: a tool's own ID, or `<message>:<text|reasoning>:<n>`. */
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

function constructRows(input: Input) {
  const { turns, leading } = constructTurns(input)

  const activeMessageID =
    turns.findLast(
      (turn) => !input.pendingInputIDs?.has(turn.id) || turn.entries.some((entry) => entry.type === "idle"),
    )?.id ?? turns.at(-1)?.id

  // The thought the model is writing stands at the end of the turn in place of the status line, wherever thinking
  // shows. Once finished, it settles where the setting puts thoughts.
  const livePlacement = liveThinkingShows(input.detail) ? "separate" : "hidden"

  const turnPhaseByID = new Map(
    turns.map(
      (turn) => [turn.id, turnPhase(turn.entries, turn.id === activeMessageID, input.status, livePlacement)] as const,
    ),
  )

  const phaseOf = (turn: Turn) => turnPhaseByID.get(turn.id) ?? IDLE_TURN_PHASE

  const commentary = new Set(
    input.detail.commentary.placement !== "separate"
      ? turns.flatMap((turn) => turnCommentary(turn.entries, viewTurnPhase(phaseOf(turn)).settled, input.shows))
      : [],
  )

  const visible = (content: Content) =>
    !(input.detail.commentary.placement === "hidden" && commentary.has(content)) && input.shows(content)

  const noticeShows = (message: Notice) => noticePlacement(input.detail, message) !== "hidden"

  // Your messages and the commands you ran always show; any other turn shows when something in it does.
  const visibleTurns = turns.filter(
    (turn) =>
      turn.user ||
      turn.shell ||
      turn.entries.some((entry) =>
        entry.type === "notice"
          ? noticeShows(entry.message)
          : entry.type === "idle" ||
            entry.type === "diff" ||
            !!entry.message.error ||
            !!entry.message.retry ||
            entry.message.content.some(visible),
      ),
  )

  const rows: TimelineRow.TimelineRow[] = [
    ...leading
      .filter(noticeShows)
      .map((message) => new TimelineRow.Notice({ userMessageID: turns[0]?.id ?? message.id, messageID: message.id })),
    ...visibleTurns.flatMap((turn, index) => {
      if (turn.shell)
        return [
          ...(index > 0 ? [new TimelineRow.TurnGap({ userMessageID: turn.id })] : []),
          new TimelineRow.Shell({ userMessageID: turn.id, messageID: turn.shell.id }),
          ...turn.entries.flatMap((entry) =>
            entry.type === "notice" && noticeShows(entry.message)
              ? [new TimelineRow.Notice({ userMessageID: turn.id, messageID: entry.message.id })]
              : [],
          ),
        ]

      return turnRows(turn, index > 0, phaseOf(turn), input.detail, visible, commentary)
    }),
  ]

  // Like the TUI, a queued compaction waits after the active turn and ahead of every steer still waiting for delivery.
  // Notices waiting for delivery are already in the active turn, since they report what happened.
  const pendingAt = rows.findIndex((row) => input.pendingInputIDs?.has(row.userMessageID))

  rows.splice(
    pendingAt < 0 ? rows.length : pendingAt,
    0,
    // Live status ends the turn, so it stays above the input the user steered in, which waits for the agent to reply.
    ...(input.status.type !== "idle" && activeMessageID && (pendingAt >= 0 || input.queuedCompactionIDs.length > 0)
      ? [new TimelineRow.Activity({ userMessageID: activeMessageID })]
      : []),
    ...input.queuedCompactionIDs.map(
      (inboxID) => new TimelineRow.CompactionQueued({ userMessageID: activeMessageID ?? inboxID, inboxID }),
    ),
  )

  const messageByID = new Map(input.messages.map((message) => [message.id, message]))

  return { activeMessageID, turnPhaseByID, rows: groupNotices(rows, input.detail, messageByID) }
}

// Everything since the last idle marker is one turn, including prompts steered in meanwhile. Notices before the first
// turn have none to join, so they lead.
function constructTurns(input: Input) {
  const userShellIDs = new Set(input.messages.flatMap((message) => (message.type === "shell" ? [message.shellID] : [])))
  const turns: Turn[] = []
  const leading: Notice[] = []
  const turnByUserID = new Map<string, Turn>()
  let current: Turn | undefined
  let execution: { opener: string; turn: Turn; files: Set<string> } | undefined

  const appendIdle = (message: SessionMessageIdle) => {
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

    if (lastStep?.type === "assistant" && lastStep.message.error && !isInterruptedError(lastStep.message.error)) return

    if (current && !current.shell) {
      current.entries.push({ type: "idle", message })

      return
    }

    const turn: Turn = { id: message.id, time: message.time, entries: [{ type: "idle", message }] }
    turns.push(turn)
    current = turn
  }

  input.messages.forEach((message) => {
    if (echoesUserShell(message, userShellIDs)) return

    if (isNotice(message)) {
      // A notice still waiting for delivery, such as a subagent reporting back, already happened, so it joins the
      // working turn above the status line, even when input the user steered in meanwhile waits below it.
      const turn = input.pendingInputIDs?.has(message.id) ? (execution?.turn ?? current) : current

      if (turn) turn.entries.push({ type: "notice", message })
      else leading.push(message)

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
      if (!input.pendingInputIDs?.has(message.id))
        execution = { opener: execution?.opener ?? message.id, turn, files: execution?.files ?? new Set() }

      return
    }

    if (message.type === "idle") {
      appendIdle(message)

      // The summary follows the turn's last prompt, after any failure the marker reports.
      // Sorted like the diff route's git order, so the list keeps its order when the diffs arrive.
      if (input.turnDiffs && execution?.files.size)
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

    if (current && !current.shell) {
      current.entries.push({ type: "assistant", message })

      return
    }

    const turn: Turn = { id: message.id, time: message.time, entries: [{ type: "assistant", message }] }
    turns.push(turn)
    current = turn
  })

  return { turns, leading }
}

function turnRows(
  turn: Turn,
  previousTurn: boolean,
  phase: TurnPhase,
  detail: TimelineDetail,
  isVisible: (content: Content) => boolean,
  commentary: ReadonlySet<Content>,
) {
  const rows: TimelineRow.TimelineRow[] = []
  const assistantMessages = turn.entries.flatMap((entry) => (entry.type === "assistant" ? [entry.message] : []))
  const lastAssistant = assistantMessages.at(-1)
  const lastStep = turn.entries.findLast((entry) => entry.type === "assistant" || entry.type === "idle")
  const view = viewTurnPhase(phase)
  const thinking = view.separateThinkingRef

  if (previousTurn) rows.push(new TimelineRow.TurnGap({ userMessageID: turn.id }))

  if (turn.user) rows.push(new TimelineRow.UserMessage({ userMessageID: turn.id }))

  let assistantGroupIndex = 0
  let previousAssistantTool = false

  // An assistant message can produce several rows because its content parts are rendered separately. Notices end a
  // segment so none of those rows cross it.
  const appendAssistantSegment = (messages: SessionMessageAssistant[]) => {
    const refs = messages.flatMap((message, messageIndex) =>
      contentEntries(message)
        .filter(
          (entry) => isVisible(entry.content) && !(thinking?.messageID === message.id && thinking.partID === entry.id),
        )
        .map((entry) => ({ messageID: message.id, messageIndex, partID: entry.id, content: entry.content })),
    )

    const interruptedAt = messages.findIndex((message) => isInterruptedError(message.error))
    const before = interruptedAt < 0 ? refs : refs.filter((ref) => ref.messageIndex <= interruptedAt)
    const after = interruptedAt < 0 ? [] : refs.filter((ref) => ref.messageIndex > interruptedAt)

    const appendGroups = (items: typeof refs) => {
      let offset = 0
      groupContent(items, detail, commentary).forEach((group) => {
        const tool = group.type !== "part" || items[offset]?.content.type !== "text"
        offset += group.type === "part" ? 1 : group.refs.length
        rows.push(
          new TimelineRow.AssistantPart({
            userMessageID: turn.id,
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

    // The user stopped the turn, so the timeline confirms it whatever the setting. Where the setting hides all of the
    // agent's activity, the work stopped first says how long it ran.
    if (interruptedAt >= 0) {
      if (hidesActivity(detail) && !rows.some((row) => Predicate.isTagged(row, "Worked")))
        rows.push(new TimelineRow.Worked({ userMessageID: turn.id }))
      rows.push(new TimelineRow.TurnDivider({ userMessageID: turn.id }))
      appendGroups(after)
    }

    if (messages.at(-1) !== lastAssistant) return

    // The live thought closes its own step, so notices that arrive meanwhile follow it.
    if (thinking) rows.push(new TimelineRow.Thinking({ userMessageID: turn.id, ref: thinking }))

    if (lastStep?.type !== "assistant") return

    if (view.retry)
      rows.push(
        new TimelineRow.Retry({
          userMessageID: turn.id,
          attempt: view.retry.attempt,
          message: view.retry.message,
          next: view.retry.next,
        }),
      )

    if (view.error) rows.push(new TimelineRow.Error({ userMessageID: turn.id, ...view.error }))
  }

  let assistantSegment: SessionMessageAssistant[] = []
  turn.entries.forEach((entry) => {
    switch (entry.type) {
      case "assistant":
        assistantSegment.push(entry.message)

        return
      case "idle":
        appendAssistantSegment(assistantSegment)
        assistantSegment = []

        if (entry === lastStep && view.error)
          rows.push(new TimelineRow.Error({ userMessageID: turn.id, ...view.error }))

        return
      case "diff":
        appendAssistantSegment(assistantSegment)
        assistantSegment = []
        rows.push(
          new TimelineRow.TurnDiff({
            userMessageID: turn.id,
            messageID: entry.message.id,
            from: entry.from,
            files: entry.files,
          }),
        )

        return
      case "notice":
        if (noticePlacement(detail, entry.message) === "hidden") return
        appendAssistantSegment(assistantSegment)
        assistantSegment = []
        rows.push(new TimelineRow.Notice({ userMessageID: turn.id, messageID: entry.message.id }))
    }
  })
  appendAssistantSegment(assistantSegment)

  return rows
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
  const last = !completed && active ? contentEntries(message).at(-1) : undefined

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

/**
 * Notices fold into the rows around them: grouped notices join the activity group, and background work reporting back
 * one after another reads as one events row, "Finished 2 subagents". Anything else between them keeps them apart, so
 * the order of events stays true.
 */
function groupNotices(
  rows: TimelineRow.TimelineRow[],
  detail: TimelineDetail,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
) {
  return rows.reduce<TimelineRow.TimelineRow[]>((result, row) => {
    const previous = result.at(-1)
    // Live status renders nothing while other feedback shows, so a group below it spaces from the content above it.
    const above = Predicate.isTagged(previous, "Activity") ? result.at(-2) : previous
    const message = Predicate.isTagged(row, "Notice") ? messageByID.get(row.messageID) : undefined
    const event = message && noticeEvent(message)

    // Work that reports back right after the activity group that started it, with nothing between, finishes there.
    if (
      event &&
      !event.failed &&
      Predicate.isTagged(previous, "AssistantPart") &&
      previous.group.type === "context" &&
      previous.userMessageID === row.userMessageID &&
      launches(previous.group, event, messageByID)
    ) {
      result[result.length - 1] = new TimelineRow.AssistantPart({
        ...previous,
        group: { ...previous.group, refs: [...previous.group.refs, { messageID: message.id, partID: message.id }] },
      })

      return result
    }

    const type = message ? noticeGroup(detail, message) : undefined

    const current =
      Predicate.isTagged(row, "Notice") && type
        ? new TimelineRow.AssistantPart({
            userMessageID: row.userMessageID,
            previousAssistantPart: Predicate.isTagged(above, "AssistantPart"),
            spacing:
              Predicate.isTagged(above, "AssistantPart") || Predicate.isTagged(above, "Error") ? "tool" : undefined,
            group: {
              type,
              key: `${type === "context" ? "message" : "events"}:${row.messageID}`,
              refs: [{ messageID: row.messageID, partID: row.messageID }],
            },
          })
        : row

    if (
      Predicate.isTagged(previous, "AssistantPart") &&
      Predicate.isTagged(current, "AssistantPart") &&
      previous.userMessageID === current.userMessageID &&
      previous.group.type !== "part" &&
      current.group.type !== "part" &&
      joins(previous.group, current.group, messageByID)
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

// Activity groups next to each other read as one, except that notices never join a run of thoughts: the thoughts stay
// thought rows, and the notices a row of their own. Notices reporting back join each other, never the calls that
// started the work, which count separately.
function joins(
  previous: Exclude<PartGroup, { type: "part" }>,
  current: Exclude<PartGroup, { type: "part" }>,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
) {
  const notices = (group: Exclude<PartGroup, { type: "part" }>) =>
    group.refs.every((ref) => ref.messageID === ref.partID)

  const thoughts = (group: Exclude<PartGroup, { type: "part" }>) =>
    group.refs.every((ref) => resolveContent(messageByID.get(ref.messageID), ref.partID)?.type === "reasoning")

  if (previous.type === "context" && current.type === "context")
    return !((notices(previous) && thoughts(current)) || (thoughts(previous) && notices(current)))

  return previous.type === "events" && current.type === "events" && notices(previous) && notices(current)
}

// Whether an activity group started the work an event is about.
function launches(
  group: Exclude<PartGroup, { type: "part" }>,
  event: TimelineEvent,
  messageByID: ReadonlyMap<string, SessionMessageInfo>,
) {
  const key = workKey(event)

  return (
    key !== undefined &&
    group.refs.some((ref) => {
      const content = resolveContent(messageByID.get(ref.messageID), ref.partID)
      const launch = content?.type === "tool" && toolRule(content).layout === "event" ? toolEvent(content) : undefined

      return launch !== undefined && workKey(launch) === key
    })
  )
}

function noticeGroup(detail: TimelineDetail, message: SessionMessageInfo) {
  if (noticeEvent(message)) return "events" as const

  return noticePlacement(detail, message) === "grouped" ? ("context" as const) : undefined
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

function groupContent(
  items: { messageID: string; partID: string; content: Content }[],
  detail: TimelineDetail,
  commentary: ReadonlySet<Content>,
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
    const type = contentGroup(detail, item.content, commentary)

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

function isNotice(message: SessionMessageInfo): message is Notice {
  if (message.type === "user" || message.type === "assistant" || message.type === "shell" || message.type === "idle")
    return false

  if (message.type !== "synthetic") return true

  return !!message.description?.trim() || timelineNoticeRequired(message)
}
