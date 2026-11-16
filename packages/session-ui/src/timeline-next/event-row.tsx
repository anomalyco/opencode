import { Badge } from "@opencode/ui/badge"
import { useI18n } from "@opencode/ui/context/i18n"
import { For, Match, Show, Switch, createMemo } from "solid-js"
import { BasicTool } from "../components/basic-tool"
import { useData } from "../context/data"
import { taskAgentName } from "../tools/tool-renderer"
import { summarizeShells, verbKeys, type TimelineEvent } from "./events"

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
  const summary = createMemo(() => summarizeShells(props.events))
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
      {/* A subagent leads with its status chip. */}
      <Show when={props.event.kind === "subagent"}>
        <span data-slot="timeline-event-item-status" data-state={state()}>
          <StatusGlyph state={state()} />
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

/** The status chip's glyph: ring, ↻, ✓, ✕ or ■, drawn at 12px in the chip's text color. */
function StatusGlyph(props: { state: SubagentState }) {
  return (
    <svg data-slot="timeline-event-item-glyph" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <Switch>
        <Match when={props.state === "started"}>
          <circle cx="8" cy="8" r="4.5" stroke="currentColor" stroke-width="1.4" />
        </Match>
        <Match when={props.state === "updated"}>
          <path
            d="M12.5 8a4.5 4.5 0 1 1-1.4-3.25M12.5 3v2.5H10"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.state === "completed"}>
          <path
            d="M3.8 8.3l2.7 2.7 5.7-6"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </Match>
        <Match when={props.state === "failed"}>
          <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </Match>
        <Match when={props.state === "stopped"}>
          <rect x="4.75" y="4.75" width="6.5" height="6.5" rx="1.2" fill="currentColor" />
        </Match>
      </Switch>
    </svg>
  )
}
