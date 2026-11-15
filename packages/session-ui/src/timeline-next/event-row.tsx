import { Badge } from "@opencode/ui/badge"
import { useI18n } from "@opencode/ui/context/i18n"
import { For, Show, createMemo } from "solid-js"
import { BasicTool } from "../components/basic-tool"
import { useData } from "../context/data"
import { taskAgentName } from "../tools/tool-renderer"
import { kindKeys, summarizeEvents, verbKeys, type TimelineEvent } from "./events"

/**
 * A run of subagent and background shell events, read like a group label: "Started 2 subagents · Finished 1 shell".
 * Opening it lists each one; a subagent opens its session, and a shell jumps to the call that ran it.
 */
export function TimelineEventRow(props: {
  events: readonly TimelineEvent[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onRevealShell?: (shellID: string) => void
}) {
  const i18n = useI18n()
  const summary = createMemo(() => summarizeEvents(props.events))
  const items = createMemo(() => props.events.filter((event) => event.title))

  return (
    <Show when={summary().verbs.length > 0}>
      <div data-component="timeline-event-row">
        <BasicTool
          icon="task"
          compact
          hasContent={items().length > 0}
          open={props.open}
          onOpenChange={props.onOpenChange}
          trigger={
            <div data-component="context-tool-group-trigger" data-timeline-event="">
              <span data-slot="context-tool-group-title" data-activity="">
                <For each={summary().verbs}>
                  {(bucket, index) => (
                    <>
                      <Show when={index() > 0}>
                        <span data-slot="context-tool-group-separator">·</span>
                      </Show>
                      <span data-slot="context-tool-group-verb">{i18n.t(verbKeys[bucket.verb])}</span>
                      <span data-slot="context-tool-group-detail">
                        {bucket.kinds.map((item) => i18n.plural(kindKeys[item.kind], item.count)).join(", ")}
                      </span>
                    </>
                  )}
                </For>
                {/* Where every one failed, the tag says so without counting them again. */}
                <Show when={summary().failed}>
                  {(count) => (
                    <Badge data-slot="timeline-event-failed" variant="danger">
                      {count() === props.events.length
                        ? i18n.t("ui.timeline.event.allFailed")
                        : i18n.t("ui.timeline.event.failed", { count: count() })}
                    </Badge>
                  )}
                </Show>
              </span>
            </div>
          }
        >
          <div data-component="timeline-event-list">
            <For each={items()}>
              {(event) => <TimelineEventItem event={event} onRevealShell={props.onRevealShell} />}
            </For>
          </div>
        </BasicTool>
      </div>
    </Show>
  )
}

/** One subagent or shell an events row or an opened activity group lists: who did it and what it was. */
export function TimelineEventItem(props: { event: TimelineEvent; onRevealShell?: (shellID: string) => void }) {
  const i18n = useI18n()
  const data = useData()

  const name = () =>
    props.event.kind === "shell"
      ? i18n.t("ui.tool.shell")
      : (taskAgentName(props.event.agent, data.store.agent) ?? i18n.t("ui.tool.agent.default"))

  const href = () => (props.event.sessionID ? data.sessionHref?.(props.event.sessionID) : undefined)

  const open = () => {
    const session = props.event.sessionID

    if (session && data.navigateToSession) return data.navigateToSession(session)

    if (props.event.shellID) props.onRevealShell?.(props.event.shellID)
  }

  const clickable = () => !!((props.event.sessionID && (data.navigateToSession || href())) || props.event.shellID)

  return (
    <a
      data-slot="timeline-event-item"
      data-kind={props.event.kind}
      href={href()}
      role={clickable() && !href() ? "button" : undefined}
      tabIndex={clickable() ? 0 : undefined}
      aria-disabled={clickable() ? undefined : "true"}
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

        if (!clickable()) return
        event.preventDefault()
        open()
      }}
      onKeyDown={(event) => {
        if (!clickable() || href() || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        open()
      }}
    >
      <span data-slot="timeline-event-item-name">{name()}</span>
      <span data-slot="timeline-event-item-title">{props.event.title}</span>
      <Show when={props.event.failed}>
        <Badge variant="danger">{i18n.t("ui.toolErrorCard.failed")}</Badge>
      </Show>
    </a>
  )
}
