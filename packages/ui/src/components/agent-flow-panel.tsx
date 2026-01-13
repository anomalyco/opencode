import { Show, For, createMemo } from "solid-js"
import { AgentFlowNode, type AgentNode } from "./agent-flow-node"
import { Icon } from "./icon"
import { Spinner } from "./spinner"
import "./agent-flow-panel.css"

export interface AgentFlowPanelProps {
  nodes: AgentNode[]
  onSelectNode?: (node: AgentNode) => void
  class?: string
}

export function AgentFlowPanel(props: AgentFlowPanelProps) {
  const stats = createMemo(() => {
    const countNodes = (nodes: AgentNode[]): { total: number; complete: number; failed: number; running: number } => {
      let total = 0, complete = 0, failed = 0, running = 0
      for (const node of nodes) {
        total++
        if (node.status === "complete") complete++
        if (node.status === "failed") failed++
        if (node.status === "running") running++
        if (node.children) {
          const child = countNodes(node.children)
          total += child.total
          complete += child.complete
          failed += child.failed
          running += child.running
        }
      }
      return { total, complete, failed, running }
    }
    return countNodes(props.nodes)
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

        <div data-slot="flow">
          <For each={props.nodes}>
            {(node) => (
              <AgentFlowNode
                node={node}
                onSelect={props.onSelectNode}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
