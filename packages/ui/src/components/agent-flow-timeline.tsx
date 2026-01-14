import { Show, For, createMemo } from "solid-js"
import { Icon } from "./icon"
import { Spinner } from "./spinner"
import { TimelineCard } from "./timeline-card"
import type { AgentFlowNode } from "./agent-flow-graph"
import "./agent-flow-timeline.css"

export interface AgentFlowTimelineProps {
  nodes: AgentFlowNode[]
  prompt?: string
  onSelectNode?: (node: AgentFlowNode) => void
  class?: string
}

export function AgentFlowTimeline(props: AgentFlowTimelineProps) {
  // Build tree structure and flatten to display order
  const sortedNodes = createMemo(() => {
    const nodes = props.nodes
    const childrenMap = new Map<string, AgentFlowNode[]>()
    const roots: AgentFlowNode[] = []

    // Build parent-child relationships
    for (const node of nodes) {
      if (!node.parentId) {
        roots.push(node)
      } else {
        const children = childrenMap.get(node.parentId) ?? []
        children.push(node)
        childrenMap.set(node.parentId, children)
      }
    }

    // Flatten tree to display order with depth info
    const result: Array<{ node: AgentFlowNode; depth: number }> = []

    function addNodeWithChildren(node: AgentFlowNode, depth: number) {
      result.push({ node, depth })
      const children = childrenMap.get(node.id) ?? []
      for (const child of children) {
        addNodeWithChildren(child, depth + 1)
      }
    }

    for (const root of roots) {
      addNodeWithChildren(root, 0)
    }

    return result
  })

  const stats = createMemo(() => {
    const nodes = props.nodes
    const total = nodes.length
    const complete = nodes.filter((n) => n.status === "complete").length
    const failed = nodes.filter((n) => n.status === "failed").length
    const running = nodes.filter((n) => n.status === "running").length
    return { total, complete, failed, running }
  })

  const startTime = createMemo(() => {
    const firstNode = props.nodes[0]
    if (!firstNode?.startTime) return null
    return new Date(firstNode.startTime).toLocaleTimeString()
  })

  return (
    <div data-component="agent-flow-timeline" class={props.class}>
      <Show
        when={props.nodes.length > 0}
        fallback={
          <div data-slot="empty">
            <Icon name="workflow" data-slot="empty-icon" />
            <div data-slot="empty-title">No Agent Activity</div>
            <div data-slot="empty-description">
              Agent calls will appear here when you run commands that use the orchestrator.
            </div>
          </div>
        }
      >
        {/* Header */}
        <div data-slot="header">
          <div data-slot="header-content">
            <Icon name="workflow" data-slot="header-icon" />
            <span data-slot="header-text">{props.prompt ?? "Processing request..."}</span>
          </div>
          <div data-slot="header-meta">
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
                <Icon name="close" /> {stats().failed}
              </span>
            </Show>
            <Show when={startTime()}>
              <span data-slot="timestamp">{startTime()}</span>
            </Show>
          </div>
        </div>

        {/* Timeline */}
        <div data-slot="timeline">
          <div data-slot="line" />

          <For each={sortedNodes()}>
            {(item) => (
              <div
                data-slot="timeline-item"
                data-status={item.node.status}
                data-depth={item.depth}
                style={{ "--depth": item.depth }}
              >
                <div data-slot="marker">
                  <Show when={item.node.status === "running"}>
                    <Spinner />
                  </Show>
                  <Show when={item.node.status === "complete"}>
                    <Icon name="check" />
                  </Show>
                  <Show when={item.node.status === "failed"}>
                    <Icon name="close" />
                  </Show>
                  <Show when={item.node.status === "pending"}>
                    <span data-slot="marker-dot" />
                  </Show>
                </div>
                <div data-slot="connector" />
                <TimelineCard
                  node={item.node}
                  onSelect={props.onSelectNode}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
