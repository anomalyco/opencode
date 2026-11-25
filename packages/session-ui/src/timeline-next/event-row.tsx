import { Badge } from "@opencode/ui/badge"
import { useI18n } from "@opencode/ui/context/i18n"
import { For, Show, createMemo } from "solid-js"
import { BasicTool } from "../components/basic-tool"
import { useData } from "../context/data"
import { taskAgentName } from "../tools/tool-renderer"
import { factsOf, summarize } from "../timeline/facts"
import { verbKeys, type TimelineEvent } from "./events"

/**
 * A run of background shells. Opening its summary lists each command and links back to its call.
 */
export function TimelineEventRow(props: {
  events: readonly TimelineEvent[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onRevealShell?: (shellID: string) => void
}) {
  const i18n = useI18n()

  const summary = createMemo(
    () =>
      summarize(
        factsOf(
          props.events.map(({ kind, verb, failed }, index) => ({
            type: "outcome" as const,
            id: String(index),
            outcome: { kind, verb, failed },
          })),
        ),
      ).background,
  )

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
                        {i18n.plural("ui.timeline.event.shells", bucket.count)}
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

type SubagentState = "started" | "updated" | "completed" | "failed" | "stopped"

const statusKeys = {
  started: verbKeys.started,
  updated: "ui.timeline.subagent.updated",
  completed: "ui.timeline.subagent.completed",
  failed: "ui.toolErrorCard.failed",
  stopped: verbKeys.stopped,
} as const

/** One subagent or shell an events row or an opened activity group lists: who did it and what it was. */
export function TimelineEventItem(props: { event: TimelineEvent; onRevealShell?: (shellID: string) => void }) {
  const i18n = useI18n()
  const data = useData()

  const name = () => {
    if (props.event.kind === "shell") return i18n.t("ui.tool.shell")
    const agent = taskAgentName(props.event.agent, data.store.agent)

    return agent ? i18n.t("ui.timeline.subagent.name", { name: agent }) : i18n.t("ui.tool.agent.default")
  }

  const href = () => (props.event.sessionID ? data.sessionHref?.(props.event.sessionID) : undefined)

  const open = () => {
    const session = props.event.sessionID

    if (session && data.navigateToSession) return data.navigateToSession(session)

    if (props.event.shellID) props.onRevealShell?.(props.event.shellID)
  }

  const clickable = () => !!((props.event.sessionID && (data.navigateToSession || href())) || props.event.shellID)

  const state = (): SubagentState => {
    if (props.event.failed) return "failed"

    if (props.event.verb === "ran" || props.event.verb === "finished") return "completed"

    return props.event.verb
  }

  return (
    <a
      data-slot="timeline-event-item"
      data-kind={props.event.kind}
      href={href()}
      role={clickable() && !href() ? (props.event.kind === "subagent" ? "link" : "button") : undefined}
      tabIndex={clickable() ? 0 : undefined}
      aria-disabled={clickable() ? undefined : "true"}
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

        if (href() && !data.navigateToSession) return

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
      {/* A subagent leads with its status. */}
      <Show when={props.event.kind === "subagent"}>
        <span data-slot="timeline-event-item-status" data-state={state()}>
          {i18n.t(statusKeys[state()])}
        </span>
      </Show>
      <span data-slot="timeline-event-item-name">{name()}</span>
      <Show when={props.event.title}>
        <bdi dir="auto" data-slot="timeline-event-item-title">
          {props.event.title}
        </bdi>
      </Show>
      <Show when={props.event.failed && props.event.kind === "shell"}>
        <Badge variant="danger">{i18n.t("ui.toolErrorCard.failed")}</Badge>
      </Show>
    </a>
  )
}
