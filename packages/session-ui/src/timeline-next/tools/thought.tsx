import type { SessionMessageAssistantReasoning } from "@opencode/client/promise"
import { useI18n } from "@opencode/ui/context/i18n"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, Index, Show } from "solid-js"
import { BasicTool } from "../../components/basic-tool"
import { PacedMarkdown } from "../../message/message-content"

export type ThoughtPart = SessionMessageAssistantReasoning & { id: string; streaming?: boolean }

/**
 * Thoughts one after another read like one row of activity: Thought, then how long they took together. Opening it
 * shows each thought in turn.
 */
export function ThoughtRow(props: {
  parts: ThoughtPart[]
  streaming: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  const i18n = useI18n()

  const duration = createMemo(() => {
    const durations = props.parts.flatMap((part) =>
      part.time?.completed === undefined ? [] : [Math.max(0, part.time.completed - part.time.created)],
    )

    if (props.parts.length === 0 || durations.length < props.parts.length) return undefined
    const total = Math.round(durations.reduce((sum, duration) => sum + duration, 0) / 1000)
    const numfmt = new Intl.NumberFormat(i18n.locale())

    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })

    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt.format(Math.floor(total / 60)),
      seconds: numfmt.format(total % 60),
    })
  })

  return (
    // Each thought's body carries its own ID, so quotes and anchors resolve to that body rather than the header.
    <div data-component="reasoning-part" data-timeline-part-ids={props.parts.map((part) => part.id).join(",")}>
      <BasicTool
        icon="mcp"
        status={props.streaming ? "running" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        hideDetails={props.parts.every((part) => !part.text.trim())}
        open={props.open}
        defaultOpen={props.defaultOpen}
        onOpenChange={(value) => {
          props.onOpenChange?.(value)
          props.onContentRendered?.()
        }}
        trigger={
          <div data-component="context-tool-group-trigger">
            <span data-slot="context-tool-group-title" data-activity="">
              <span data-slot="context-tool-group-verb">
                <TextShimmer
                  text={i18n.t(props.streaming ? "ui.sessionTurn.status.thinking" : "ui.message.thought")}
                  active={props.streaming}
                />
              </span>
              <Show when={!props.streaming && duration()}>
                {(value) => <span data-slot="context-tool-group-elapsed">{value()}</span>}
              </Show>
            </span>
          </div>
        }
      >
        <div data-slot="reasoning-part-run">
          <Index each={props.parts}>
            {(part) => (
              <Show when={part().text.trim() || part().streaming}>
                <div data-timeline-part-id={part().id}>
                  <PacedMarkdown text={part().text} cacheKey={part().id} streaming={part().streaming ?? false} />
                </div>
              </Show>
            )}
          </Index>
        </div>
      </BasicTool>
    </div>
  )
}
