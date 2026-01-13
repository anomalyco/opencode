import { Show, For, createMemo } from "solid-js"
import { AgentCard, type AgentCardNode } from "./agent-card"
import { Icon } from "./icon"
import { Spinner } from "./spinner"
import "./agent-flow-panel.css"

export interface AgentFlowPanelProps {
  nodes: AgentCardNode[]
  onSelectNode?: (node: AgentCardNode) => void
  class?: string
}

export function AgentFlowPanel(props: AgentFlowPanelProps) {
  const stats = createMemo(() => {
    const nodes = props.nodes
    const total = nodes.length
    const complete = nodes.filter((n) => n.status === "complete").length
    const failed = nodes.filter((n) => n.status === "failed").length
    const running = nodes.filter((n) => n.status === "running").length
    return { total, complete, failed, running }
  })

  return (
    <div data-component="agent-flow-panel" class={props.class}>
      <Show
        when={props.nodes.length > 0}
        fallback={
          <div data-slot="empty">
            <Icon name="branch" data-slot="empty-icon" />
            <div data-slot="empty-title">No Agent Activity</div>
            <div data-slot="empty-description">
              Agent calls will appear here when you run commands that use the orchestrator.
            </div>
          </div>
        }
      >
        <div data-slot="header">
          <div data-slot="title">Agent Flow</div>
          <div data-slot="stats">
            <Show when={stats().running > 0}>
              <span data-slot="stat" data-type="running">
                <Spinner /> {stats().running} running
              </span>
            </Show>
            <span data-slot="stat" data-type="complete">
              <Icon name="check" /> {stats().complete}/{stats().total}
            </span>
            <Show when={stats().failed > 0}>
              <span data-slot="stat" data-type="failed">
                <Icon name="close" /> {stats().failed} failed
              </span>
            </Show>
          </div>
        </div>

        <div data-slot="grid">
          <For each={props.nodes}>
            {(node) => <AgentCard node={node} onSelect={props.onSelectNode} />}
          </For>
        </div>
      </Show>
    </div>
  )
}
