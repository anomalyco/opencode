import type { SessionMessageAssistantReasoning } from "@opencode/client/promise"
import { useI18n } from "@opencode/ui/context/i18n"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, Show } from "solid-js"
import { BasicTool } from "../../components/basic-tool"
import { PacedMarkdown } from "../../message/message-content"

/** A thought on its own row reads like a row of activity: Thought, then how long it took. Opening it shows the thought. */
export function ThoughtRow(props: {
  id: string
  content: SessionMessageAssistantReasoning
  streaming: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  const i18n = useI18n()

  const duration = createMemo(() => {
    const time = props.content.time

    if (time?.completed === undefined) return undefined
    const total = Math.max(0, Math.round((time.completed - time.created) / 1000))
    const numfmt = new Intl.NumberFormat(i18n.locale())

    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })

    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt.format(Math.floor(total / 60)),
      seconds: numfmt.format(total % 60),
    })
  })

  return (
    <div data-component="reasoning-part" data-timeline-part-id={props.id}>
      <BasicTool
        icon="mcp"
        status={props.streaming ? "running" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        hideDetails={!props.content.text.trim()}
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
        <PacedMarkdown text={props.content.text} cacheKey={props.id} streaming={props.streaming} />
      </BasicTool>
    </div>
  )
}
