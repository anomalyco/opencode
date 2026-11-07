import type { SessionID } from "@opencode/client/promise"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { For, Match, Show, Switch, createMemo, createUniqueId } from "solid-js"
import { agentGraphLayout } from "./layout"
import { messagesFor, type AgentGraph, type TunnelMessage, type TunnelMessageKind } from "./model"
import "./agent-graph.css"

/** A selected message conversation, keyed by its endpoints; the host owns the selection. */
export type AgentGraphMessageSelection = {
  from: SessionID
  to: SessionID
}

/** The arrow-key direction a message arc or node moves focus along, or none for other keys. */
const arrowFor = (key: string) => {
  switch (key) {
    case "ArrowLeft":
      return { dx: -1, dy: 0 }
    case "ArrowRight":
      return { dx: 1, dy: 0 }
    case "ArrowUp":
      return { dx: 0, dy: -1 }
    case "ArrowDown":
      return { dx: 0, dy: 1 }
    default:
      return undefined
  }
}

const POPOVER_WIDTH = 320

/**
 * The Session family graph: spawn links and directed message arcs in one SVG layer, with nodes as
 * positioned HTML buttons sharing the layout coordinates. Clicking (or keyboard-selecting) a
 * message arc reveals its conversation; the component only presents, the host streams and selects.
 */
export function AgentGraph(props: {
  graph: AgentGraph
  /** Tunnel messages between family members; a selected arc lists its conversation. */
  messages?: readonly TunnelMessage[]
  /** The selected node, drawn highlighted; the host owns the selection. */
  selectedNodeID?: SessionID
  /** The selected message pair, whose arc stays highlighted and whose conversation shows. */
  selectedPair?: AgentGraphMessageSelection
  onSelectNode: (nodeID: SessionID) => void
  onSelectMessages: (pair: AgentGraphMessageSelection | undefined) => void
}) {
  const i18n = useI18n()
  const uid = createUniqueId()
  const layout = createMemo(() => agentGraphLayout(props.graph))
  const byID = createMemo(() => new Map(props.graph.nodes.map((node) => [node.id, node])))
  const positions = createMemo(() => new Map(layout().nodes.map((node) => [node.id, node])))
  const buttons = new Map<SessionID, HTMLButtonElement>()

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const money = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { style: "currency", currency: "USD" }),
  )

  const clock = createMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale(), {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
  )

  const conversation = createMemo(() => {
    const pair = props.selectedPair

    if (!pair) return undefined

    return { pair, entries: messagesFor(props.messages ?? [], pair.from, pair.to) }
  })

  // The conversation shows near the midpoint of its nodes, kept inside the canvas.
  const anchor = createMemo(() => {
    const pair = conversation()?.pair

    if (!pair) return undefined
    const from = positions().get(pair.from)
    const to = positions().get(pair.to)

    if (!from || !to) return undefined

    const midX = (from.x + from.width / 2 + to.x + to.width / 2) / 2
    const midY = (from.y + from.height / 2 + to.y + to.height / 2) / 2

    return {
      x: Math.min(Math.max(midX - POPOVER_WIDTH / 2, 0), Math.max(layout().width - POPOVER_WIDTH, 0)),
      y: Math.min(midY + 28, Math.max(layout().height - 240, 0)),
    }
  })

  const kindLabel = (kind: TunnelMessageKind) =>
    i18n.t(kind === "message" ? "ui.agentGraph.messages.kind.message" : "ui.agentGraph.messages.kind.report")

  const nameOf = (id: SessionID) => {
    const node = byID().get(id)

    return node ? node.agentName ?? node.agent ?? node.label : id
  }

  const selectNode = (id: SessionID) => {
    if (props.selectedPair) props.onSelectMessages(undefined)

    props.onSelectNode(id)
  }

  // The axis along the arrow dominates; movement across it counts double against a candidate.
  const focusNear = (id: SessionID, dx: number, dy: number) => {
    const current = positions().get(id)

    if (!current) return

    let best: { id: SessionID; score: number } | undefined

    for (const candidate of positions().values()) {
      if (candidate.id === id) continue

      const dxTo = candidate.x + candidate.width / 2 - (current.x + current.width / 2)
      const dyTo = candidate.y + candidate.height / 2 - (current.y + current.height / 2)
      const forward = dx * dxTo + dy * dyTo

      if (forward <= 0) continue

      const score = forward + 2 * Math.abs(dx * dyTo - dy * dxTo)

      if (!best || score < best.score) best = { id: candidate.id, score }
    }

    const button = best ? buttons.get(best.id) : undefined

    if (button?.isConnected) button.focus()
  }

  return (
    <div
      data-component="agent-graph"
      data-pair-selected={props.selectedPair ? "" : undefined}
      style={{
        width: layout().nodes.length > 0 ? `${layout().width}px` : undefined,
        height: layout().nodes.length > 0 ? `${layout().height}px` : undefined,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && props.selectedPair) props.onSelectMessages(undefined)
      }}
    >
      <Show
        when={layout().nodes.length > 0}
        fallback={
          <div data-slot="agent-graph-empty">
            <p data-slot="agent-graph-empty-title">{i18n.t("ui.agentGraph.empty.title")}</p>
            <p data-slot="agent-graph-empty-body">{i18n.t("ui.agentGraph.empty.body")}</p>
          </div>
        }
      >
        <svg
          data-slot="agent-graph-edges"
          width={layout().width}
          height={layout().height}
          viewBox={`0 0 ${layout().width} ${layout().height}`}
        >
          <defs>
            <marker
              id={`${uid}-message`}
              data-slot="agent-graph-marker"
              data-kind="message"
              markerWidth="8"
              markerHeight="8"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 z" />
            </marker>
            <marker
              id={`${uid}-report`}
              data-slot="agent-graph-marker"
              data-kind="report"
              markerWidth="8"
              markerHeight="8"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 z" />
            </marker>
          </defs>
          <For each={layout().edges}>
            {(edge) => (
              <Switch>
                <Match when={edge.type === "message" ? edge : undefined}>
                  {(arc) => (
                    <g
                      data-slot="agent-graph-message"
                      data-kind={arc().kind}
                      data-selected={
                        props.selectedPair?.from === arc().from && props.selectedPair?.to === arc().to ? "" : undefined
                      }
                    >
                      <path
                        data-slot="agent-graph-message-arc"
                        d={arc().path}
                        marker-end={`url(#${uid}-${arc().kind})`}
                      />
                      <path
                        data-slot="agent-graph-message-hit"
                        d={arc().path}
                        tabindex={0}
                        role="button"
                        aria-label={i18n.plural("ui.agentGraph.arc.count", arc().count, {
                          from: nameOf(arc().from),
                          to: nameOf(arc().to),
                          kind: kindLabel(arc().kind),
                        })}
                        onClick={() => props.onSelectMessages({ from: arc().from, to: arc().to })}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          props.onSelectMessages({ from: arc().from, to: arc().to })
                        }}
                      />
                    </g>
                  )}
                </Match>
                <Match when={edge.type === "spawn" ? edge : undefined}>
                  {(spawn) => <path data-slot="agent-graph-spawn" d={spawn().path} aria-hidden="true" />}
                </Match>
              </Switch>
            )}
          </For>
        </svg>
        <div data-slot="agent-graph-nodes">
          <For each={props.graph.nodes}>
            {(node) => {
              const position = positions().get(node.id)
              const name = node.agentName ?? node.agent ?? node.label

              if (!position) return undefined

              return (
                <button
                  ref={(el) => buttons.set(node.id, el)}
                  type="button"
                  data-slot="agent-graph-node"
                  data-selected={props.selectedNodeID === node.id ? "" : undefined}
                  data-related={
                    props.selectedPair && (node.id === props.selectedPair.from || node.id === props.selectedPair.to)
                      ? ""
                      : undefined
                  }
                  title={node.description ?? node.label}
                  aria-label={node.status === "running" ? `${name}, ${i18n.t("ui.agentGraph.running")}` : name}
                  style={{
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    width: `${position.width}px`,
                    "--agent-graph-agent-color": node.agentColor,
                  }}
                  onClick={() => selectNode(node.id)}
                  onFocus={() => selectNode(node.id)}
                  onKeyDown={(event) => {
                    const arrow = arrowFor(event.key)

                    if (!arrow) return
                    event.preventDefault()
                    focusNear(node.id, arrow.dx, arrow.dy)
                  }}
                >
                  <span data-slot="agent-graph-node-row">
                    <span data-slot="agent-graph-node-dot" />
                    <span data-slot="agent-graph-node-name">{name}</span>
                    <Show when={node.status === "running"}>
                      <ActivityRing data-slot="agent-graph-node-running" width={12} height={12} />
                    </Show>
                  </span>
                  <Show when={node.agentName || node.agent}>
                    <span data-slot="agent-graph-node-label">{node.label}</span>
                  </Show>
                  <span data-slot="agent-graph-node-usage">
                    {i18n.t("ui.agentGraph.node.usage", {
                      tokens: compact().format(node.tokens),
                      cost: money().format(node.cost),
                    })}
                  </span>
                </button>
              )
            }}
          </For>
        </div>
        <Show when={conversation()}>
          {(conversation) => (
            <div
              data-slot="agent-graph-messages"
              role="dialog"
              aria-label={i18n.t("ui.agentGraph.messages.title")}
              style={{ left: `${anchor()?.x ?? 0}px`, top: `${anchor()?.y ?? 0}px` }}
            >
              <div data-slot="agent-graph-messages-header">
                <span data-slot="agent-graph-messages-title">{i18n.t("ui.agentGraph.messages.title")}</span>
                <span data-slot="agent-graph-messages-count">
                  {i18n.plural("ui.agentGraph.messages.count", conversation().entries.length)}
                </span>
                <button
                  type="button"
                  data-slot="agent-graph-messages-close"
                  aria-label={i18n.t("ui.agentGraph.messages.close")}
                  onClick={() => props.onSelectMessages(undefined)}
                >
                  <Icon name="close-small" size="small" />
                </button>
              </div>
              <ul data-slot="agent-graph-messages-list">
                <Show
                  when={conversation().entries.length > 0}
                  fallback={<li data-slot="agent-graph-message-none">{i18n.t("ui.agentGraph.messages.none")}</li>}
                >
                  <For each={conversation().entries}>
                    {(message) => (
                      <li data-slot="agent-graph-message-entry">
                        <div data-slot="agent-graph-message-entry-meta">
                          <span data-slot="agent-graph-message-entry-kind" data-kind={message.kind}>
                            {kindLabel(message.kind)}
                          </span>
                          <span data-slot="agent-graph-message-entry-route">
                            {i18n.t("ui.agentGraph.messages.route", {
                              from: nameOf(message.from.sessionID),
                              to: nameOf(message.to.sessionID),
                            })}
                          </span>
                          <time
                            data-slot="agent-graph-message-entry-time"
                            datetime={new Date(message.time.created).toISOString()}
                          >
                            {clock().format(new Date(message.time.created))}
                          </time>
                        </div>
                        <p data-slot="agent-graph-message-entry-body">{message.body}</p>
                      </li>
                    )}
                  </For>
                </Show>
              </ul>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}
