import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Predicate } from "effect"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { BackgroundMoveHint } from "../../../../app/src/session/timeline/message-timeline"
import type { SessionDocument } from "../../document"
import type { TimelineDetail } from "../../timeline/detail"
import { Timeline, createReactiveTimelineProjection, type ReasoningMode } from "../../timeline/projection"
import { createNextTimelineProjection } from "../projection"
import { laneGap } from "../spacing"
import { timelineStatus } from "../status"
import { StatusLane } from "../status-line"

const padding = "px-4 md:px-6"

const statusLabels = {
  waitingApproval: "Waiting for approval",
  waitingAnswer: "Waiting for your answer",
  waitingShell: "Waiting for shell",
  working: "Working",
} as const

/** The old timeline's settings as the app's timeline controller derives them from the detail setting. */
export function sessionTimelineSettings(detail: TimelineDetail) {
  const reasoningMode: ReasoningMode =
    detail.thinking.placement === "hidden" ? "hidden" : detail.thinking.details === "expanded" ? "full" : "compact"

  return {
    reasoningMode,
    shellToolDefaultOpen: detail.shell.details === "expanded",
    editToolDefaultOpen: detail.edit.details === "expanded",
  }
}

/**
 * The line below a working turn, as `MessageTimeline` in the app draws it at the bottom of the timeline: the New
 * timeline's status lane spaced like the turn's next row, or the old 36px lane, each with Working when the app shows
 * it and the offer to move a blocking call to the background. A story session has no permissions, questions, queued
 * input or background tasks, so those cases are left out.
 */
export function SessionStatusLane(props: { document: SessionDocument; timelineDetail: TimelineDetail; next: boolean }) {
  const input = {
    sessionMessages: () => props.document.messages,
    status: () => props.document.status,
    timelineDetail: () => props.timelineDetail,
    turnDiffs: () => false,
  }

  const settings = () => sessionTimelineSettings(props.timelineDetail)

  const projection = props.next
    ? createNextTimelineProjection(input)
    : createReactiveTimelineProjection({
        ...input,
        reasoningMode: () => settings().reasoningMode,
        shellToolDefaultOpen: () => settings().shellToolDefaultOpen,
        editToolDefaultOpen: () => settings().editToolDefaultOpen,
      })

  const busy = () => props.document.status.type === "busy"

  const assistant = () => {
    const active = projection.activeMessageID()

    return active ? projection.assistantMessagesByParent().get(active)?.at(-1) : undefined
  }

  const laneSpacing = createMemo(() => {
    const active = projection.activeMessageID()

    return props.next && active ? laneGap(projection.rows(), active, projection.messageByID()) : undefined
  })

  // MessageTimeline's showWorking, the old timeline's Working.
  const showWorking = createMemo(() => {
    if (!busy()) return false
    const active = projection.activeMessageID()

    if (!active) return false
    const last = assistant()

    if (last?.retry || last?.error) return false
    const content = last?.content.at(-1)

    if (
      last?.time.completed === undefined &&
      last?.time.streamed === undefined &&
      content?.type === "text" &&
      content.text.trim()
    )
      return false

    return !projection.rows().some((row) => {
      if (row.userMessageID !== active) return false

      if (Predicate.isTagged(row, "Thinking")) return true

      if (Predicate.isTagged(row, "Notice")) {
        const message = projection.messageByID().get(row.messageID)

        return message?.type === "compaction" && message.status === "running"
      }

      if (!Predicate.isTagged(row, "AssistantPart")) return false

      if (row.group.type === "context" && projection.lastAssistantGroupKey().get(active) === row.group.key)
        return row.group.refs.every(
          (ref) =>
            Timeline.resolveContent(projection.messageByID().get(ref.messageID), ref.partID)?.type === "reasoning",
        )

      if (row.group.type === "context" || row.group.type === "read") return false

      return (row.group.type === "part" ? [row.group.ref] : row.group.refs).some((ref) => {
        const content = Timeline.resolveContent(projection.messageByID().get(ref.messageID), ref.partID)

        return content?.type === "tool" && (content.state.status === "streaming" || content.state.status === "running")
      })
    })
  })

  const nextStatus = createMemo(() =>
    busy() && projection.activeMessageID() ? timelineStatus({ content: assistant()?.content ?? [] }) : undefined,
  )

  const liveThought = createMemo(() =>
    projection
      .rows()
      .some((row) => Predicate.isTagged(row, "Thinking") && row.userMessageID === projection.activeMessageID()),
  )

  const working = () => {
    if (!props.next) return showWorking()
    const status = nextStatus()

    return !!status && (status !== "working" || !liveThought())
  }

  // The app offers the move for a foreground shell, subagent or Code Mode script, which its background service
  // reports as blocking; the New timeline waits until the call has run for 300ms.
  const blocking = createMemo(() => {
    if (!busy()) return
    const last = assistant()

    return last?.content.findLast(
      (part): part is Extract<typeof part, { type: "tool" }> =>
        part.type === "tool" && part.state.status === "running" && ["shell", "subagent", "execute"].includes(part.name),
    )
  })

  const [hint, setHint] = createSignal(false)

  createEffect(() => {
    const part = blocking()

    if (!part) return setHint(false)

    const wait = props.next ? Math.max(0, (part.time.ran ?? part.time.created) + 300 - Date.now()) : 0
    const timer = setTimeout(() => setHint(true), wait)

    onCleanup(() => clearTimeout(timer))
  })

  const move = () => (
    <Show when={hint()}>
      <div data-component="session-background-hint-row">
        <BackgroundMoveHint keybind={["Ctrl", "B"]} />
      </div>
    </Show>
  )

  return (
    <div class="w-full min-w-0 max-w-full md:mx-auto md:max-w-session">
      <Show
        when={props.next}
        fallback={
          <div class={`flex h-9 items-center gap-2 pt-3 text-[13px] font-[530] leading-text-compact ${padding}`}>
            <Show when={showWorking()}>
              <div data-component="session-working" role="status">
                <TextShimmer text="Working" active />
              </div>
            </Show>
            {move()}
          </div>
        }
      >
        <StatusLane
          class={padding}
          spacing={laneSpacing()}
          label={working() ? statusLabels[nextStatus() ?? "working"] : undefined}
          collapsed={liveThought() && !working() && !hint()}
        >
          {move()}
        </StatusLane>
      </Show>
    </div>
  )
}
