import type { SessionID, SessionInfo, SessionMessageInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { For, Match, Show, Switch, createMemo } from "solid-js"
import { subtreeUsage, usageByAgent, type AgentGraphNode } from "./model"
import "./agent-graph.css"

/** One presentational log entry; streaming, buffering, and deduplication stay with the host. */
export type AgentGraphLogEntry = {
  /** Unique entry id, for keyed rendering. */
  id: string
  /** The durable event type, e.g. "session.inbox.enqueued". */
  type: string
  /** Epoch milliseconds when the event was recorded. */
  time: number
}

/** The host's log stream state for the selected Session; the machine lives outside session-ui. */
export type AgentGraphLogs =
  | { status: "connecting" }
  | { status: "live"; entries: readonly AgentGraphLogEntry[] }
  | { status: "error" }

/** The selected node's detail: identity, usage roll-ups, and a presentational log feed. */
export function AgentGraphDetail(props: {
  node: AgentGraphNode | undefined
  /** Assistant messages of the selected Session, folded per agent by `usageByAgent`. */
  messages?: readonly SessionMessageInfo[]
  /** The family's Sessions, for the subtree roll-up. */
  sessions?: readonly SessionInfo[]
  logs?: AgentGraphLogs
  onOpenSession: (sessionID: SessionID) => void
}) {
  const i18n = useI18n()

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const number = createMemo(() => new Intl.NumberFormat(i18n.locale()))

  const money = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { style: "currency", currency: "USD" }),
  )

  const clock = createMemo(
    () => new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "medium", timeStyle: "short" }),
  )

  const usage = createMemo(() => usageByAgent(props.messages ?? []))
  const subtree = createMemo(() => subtreeUsage(props.sessions ?? [], props.node?.id))
  const liveLogs = createMemo(() => (props.logs?.status === "live" ? props.logs : undefined))

  return (
    <Show when={props.node}>
      {(node) => (
        <div data-component="agent-graph-detail">
          <div data-slot="agent-graph-detail-header">
            <div data-slot="agent-graph-detail-heading">
              <span data-slot="agent-graph-detail-dot" style={{ "--agent-graph-agent-color": node().agentColor }} />
              <span data-slot="agent-graph-detail-title">{node().label}</span>
            </div>
            <Button
              size="small"
              variant="neutral"
              onClick={() => props.onOpenSession(node().id)}
              data-slot="agent-graph-detail-open"
            >
              {i18n.t("ui.agentGraph.openSession")}
              <Icon name="square-arrow" size="small" />
            </Button>
          </div>
          <dl data-slot="agent-graph-detail-identity">
            <Show when={node().agent}>
              <div data-slot="agent-graph-detail-row">
                <dt>{i18n.t("ui.agentGraph.agent")}</dt>
                <dd>{node().agentName ?? node().agent}</dd>
              </div>
            </Show>
            <Show when={node().model} keyed>
              {(model) => (
                <div data-slot="agent-graph-detail-row">
                  <dt>{i18n.t("ui.agentGraph.model")}</dt>
                  <dd>
                    {model.variant
                      ? i18n.t("ui.message.modelVariant", { model: model.id, variant: model.variant })
                      : model.id}
                  </dd>
                </div>
              )}
            </Show>
            <div data-slot="agent-graph-detail-row">
              <dt>{i18n.t("ui.agentGraph.created")}</dt>
              <dd>{clock().format(new Date(node().started))}</dd>
            </div>
            <div data-slot="agent-graph-detail-row">
              <dt>{i18n.t("ui.agentGraph.status")}</dt>
              <dd>
                {i18n.t(node().status === "running" ? "ui.agentGraph.running" : "ui.agentGraph.idle")}
              </dd>
            </div>
          </dl>
          <Show when={usage().length > 0}>
            <section data-slot="agent-graph-detail-section">
              <h3 data-slot="agent-graph-detail-section-title">{i18n.t("ui.agentGraph.usage")}</h3>
              <table data-slot="agent-graph-usage">
                <thead>
                  <tr>
                    <th scope="col">{i18n.t("ui.agentGraph.agent")}</th>
                    <th scope="col">{i18n.t("ui.agentGraph.steps")}</th>
                    <th scope="col">{i18n.t("ui.agentGraph.tokens")}</th>
                    <th scope="col">{i18n.t("ui.agentGraph.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={usage()}>
                    {(row) => (
                      <tr>
                        <th scope="row">{row.agent}</th>
                        <td>{number().format(row.steps)}</td>
                        <td>{compact().format(row.tokens)}</td>
                        <td>{money().format(row.cost)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </section>
          </Show>
          <section data-slot="agent-graph-detail-section">
            <h3 data-slot="agent-graph-detail-section-title">{i18n.t("ui.agentGraph.subtree")}</h3>
            <p data-slot="agent-graph-detail-subtree">
              {i18n.t("ui.agentGraph.subtreeSummary", {
                sessions: i18n.plural("ui.agentGraph.subtreeSessions", subtree().sessions),
                tokens: compact().format(subtree().tokens),
                cost: money().format(subtree().cost),
              })}
            </p>
          </section>
          <Show when={props.logs}>
            {(logs) => (
              <section data-slot="agent-graph-detail-section">
                <h3 data-slot="agent-graph-detail-section-title">{i18n.t("ui.agentGraph.logs.title")}</h3>
                <Switch>
                  <Match when={logs().status === "connecting" ? logs() : undefined}>
                    <p data-slot="agent-graph-logs-state">
                      <Loader data-slot="agent-graph-logs-loader" width={12} height={12} />
                      {i18n.t("ui.agentGraph.logs.connecting")}
                    </p>
                  </Match>
                  <Match when={liveLogs()}>
                    {(live) => (
                      <Show
                        when={live().entries.length > 0}
                        fallback={<p data-slot="agent-graph-logs-state">{i18n.t("ui.agentGraph.logs.empty")}</p>}
                      >
                        <ul data-slot="agent-graph-logs-list">
                          <For each={live().entries}>
                            {(entry) => (
                              <li data-slot="agent-graph-log-entry">
                                <code data-slot="agent-graph-log-type">{entry.type}</code>
                                <time data-slot="agent-graph-log-time" datetime={new Date(entry.time).toISOString()}>
                                  {clock().format(new Date(entry.time))}
                                </time>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    )}
                  </Match>
                  <Match when={logs().status === "error" ? logs() : undefined}>
                    <p data-slot="agent-graph-logs-error">{i18n.t("ui.agentGraph.logs.error")}</p>
                  </Match>
                </Switch>
              </section>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}
