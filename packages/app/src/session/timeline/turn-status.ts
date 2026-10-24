import { Predicate } from "effect"
import { createMemo, type Accessor } from "solid-js"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { Timeline, TimelineRow } from "@opencode/session-ui/timeline/projection"
import type { useLanguage } from "@/runtime/i18n/language"

/** The app translator. */
type Translate = ReturnType<typeof useLanguage>["t"]

/** The phrase the announcer speaks for one phase of a running turn. */
type TurnStatusKey =
  | "session.timeline.working"
  | "ui.messagePart.compaction.running"
  | "ui.sessionTurn.status.delegating"
  | "ui.sessionTurn.status.gatheringContext"
  | "ui.sessionTurn.status.makingEdits"
  | "ui.sessionTurn.status.responding"
  | "ui.sessionTurn.status.runningCommands"
  | "ui.sessionTurn.status.searchingCodebase"
  | "ui.sessionTurn.status.searchingWeb"
  | "ui.sessionTurn.status.thinking"
  | "ui.sessionTurn.status.waitingForYou"

/** The phrase each tool's name stands for while the tool runs. */
const TOOL_STATUS = new Map<string, TurnStatusKey>([
  ["shell", "ui.sessionTurn.status.runningCommands"],
  ["execute", "ui.sessionTurn.status.runningCommands"],
  ["read", "ui.sessionTurn.status.gatheringContext"],
  ["list", "ui.sessionTurn.status.gatheringContext"],
  ["glob", "ui.sessionTurn.status.gatheringContext"],
  ["grep", "ui.sessionTurn.status.searchingCodebase"],
  ["websearch", "ui.sessionTurn.status.searchingWeb"],
  ["webfetch", "ui.sessionTurn.status.searchingWeb"],
  ["edit", "ui.sessionTurn.status.makingEdits"],
  ["write", "ui.sessionTurn.status.makingEdits"],
  ["patch", "ui.sessionTurn.status.makingEdits"],
  ["subagent", "ui.sessionTurn.status.delegating"],
  ["task", "ui.sessionTurn.status.delegating"],
])

/** The part of the timeline projection the status reads. */
export type TurnStatusProjection = {
  activeMessageID: Accessor<string | undefined>
  assistantMessagesByParent: Accessor<ReadonlyMap<string, SessionMessageAssistant[]>>
  messageByID: Accessor<ReadonlyMap<string, SessionMessageInfo>>
  rows: Accessor<readonly TimelineRow.TimelineRow[]>
}

export type TurnStatusInput = {
  /** Whether the session is running a turn. */
  running: Accessor<boolean>
  /** Whether a permission or a form question waits for the user. */
  pendingQuestion: Accessor<boolean>
  /** Whether a steer waits behind the running turn. */
  pendingSteer: Accessor<boolean>
  /** The ids of the tasks the session moved to the background. */
  backgroundTasks: Accessor<readonly string[]>
  /** The projected timeline. */
  projection: TurnStatusProjection
  /** The app translator. */
  t: Translate
}

/**
 * The live status of the running turn. The generic "Working" chip and the announcer read the same
 * traversal, so the chip never shows while the announcer names a different phase.
 */
export function createTurnStatus(input: TurnStatusInput) {
  const turn = createMemo(() => {
    if (!input.running()) return { generic: false, key: undefined }

    if (input.pendingQuestion()) return { generic: false, key: "ui.sessionTurn.status.waitingForYou" }
    const active = input.projection.activeMessageID()

    if (!active) return { generic: false, key: "session.timeline.working" }
    const assistant = input.projection.assistantMessagesByParent().get(active)?.at(-1)

    if (assistant?.retry) return { generic: false, key: "session.timeline.working" }

    // Pending steers still project under the previous response until delivery.
    // Its error must not hide feedback for a newly submitted prompt.
    if (assistant?.error && !input.pendingSteer()) return { generic: false, key: "session.timeline.working" }
    const content = assistant?.content.at(-1)

    const responding =
      assistant?.time.completed === undefined &&
      assistant?.time.streamed === undefined &&
      content?.type === "text" &&
      !!content.text.trim()

    const background = new Set(input.backgroundTasks())
    let thinking = false
    let compacting = false
    let tool: string | undefined
    let collected: string | undefined

    for (const row of input.projection.rows()) {
      if (row.userMessageID !== active) continue

      if (Predicate.isTagged(row, "Thinking")) {
        thinking = true
        continue
      }

      if (Predicate.isTagged(row, "Notice")) {
        const message = input.projection.messageByID().get(row.messageID)

        if (message?.type === "compaction" && message.status === "running") compacting = true
        continue
      }

      // Used and read groups keep the generic fallback, so each new read does not swap Working out
      // for its short call. They still name themselves, so the announcer can say what is running.
      if (!Predicate.isTagged(row, "AssistantPart")) continue

      const grouped = row.group.type === "context" || row.group.type === "read"

      // A running tool outranks a grouped tool, so once one is found the remaining refs cannot
      // change the status. Thinking and compaction are row level, so the row scan continues.
      if (tool !== undefined) continue

      for (const ref of row.group.type === "part" ? [row.group.ref] : row.group.refs) {
        const part = Timeline.resolveContent(input.projection.messageByID().get(ref.messageID), ref.partID)

        if (part?.type !== "tool") continue

        if (part.state.status === "streaming" || part.state.status === "running") {
          if (grouped) {
            collected ??= part.name
            continue
          }

          tool ??= part.name
          break
        }

        const taskID = part.state.metadata?.[part.name === "subagent" ? "sessionID" : "shellID"]

        if (!background.has(part.id) && !(Predicate.isString(taskID) && background.has(taskID))) continue

        if (grouped) {
          collected ??= part.name
          continue
        }

        tool ??= part.name
        break
      }
    }

    if (thinking) return { generic: false, key: "ui.sessionTurn.status.thinking" }

    if (compacting) return { generic: false, key: "ui.messagePart.compaction.running" }

    if (tool) return { generic: false, key: TOOL_STATUS.get(tool) ?? "ui.sessionTurn.status.runningCommands" }

    if (responding) return { generic: false, key: "ui.sessionTurn.status.responding" }

    if (collected) return { generic: true, key: TOOL_STATUS.get(collected) ?? "ui.sessionTurn.status.runningCommands" }

    return { generic: true, key: "session.timeline.working" }
  })

  const status = createMemo(() => {
    const key = turn().key

    if (!key) return ""

    return input.t(key)
  })

  const generic = createMemo(() => turn().generic)

  return { status, generic }
}
