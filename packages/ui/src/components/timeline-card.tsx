import { Show, For, createMemo } from "solid-js"
import { Icon } from "./icon"
import { Spinner } from "./spinner"
import type { AgentFlowNode, ToolCall } from "./agent-flow-graph"
import "./timeline-card.css"

export interface TimelineCardProps {
  node: AgentFlowNode
  onSelect?: (node: AgentFlowNode) => void
  class?: string
}

const AGENT_COLORS: Record<string, string> = {
  planner: "#673AB7",
  worker: "#FF5722",
  reviewer: "#009688",
  analyst: "#4CAF50",
  strategist: "#2196F3",
  executor: "#FF9800",
  ops: "#9C27B0",
}

function getToolSummary(tool: ToolCall): string {
  if (tool.summary) return tool.summary
  if (!tool.input) return tool.tool

  const input = typeof tool.input === "string" ? tool.input : ""
  if (tool.tool === "Read" || tool.tool === "read") {
    const match = input.match(/file_path["\s:]+["']?([^"'\s,}]+)/)
    return match ? match[1].split("/").pop() ?? tool.tool : tool.tool
  }
  if (tool.tool === "Edit" || tool.tool === "edit") {
    const match = input.match(/file_path["\s:]+["']?([^"'\s,}]+)/)
    return match ? match[1].split("/").pop() ?? tool.tool : tool.tool
  }
  if (tool.tool === "Bash" || tool.tool === "bash") {
    const match = input.match(/command["\s:]+["']?([^"'\n]{0,25})/)
    return match ? match[1].trim() : tool.tool
  }
  return tool.tool
}

export function TimelineCard(props: TimelineCardProps) {
  const agentColor = () => AGENT_COLORS[props.node.agent] ?? "#666"

  const duration = createMemo(() => {
    if (!props.node.startTime) return null
    const end = props.node.endTime ?? Date.now()
    const ms = end - props.node.startTime
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  })

  const previewContent = createMemo(() => {
    const thumb = props.node.thumbnail
    if (thumb) return thumb.content.slice(0, 500)
    if (props.node.output) return props.node.output.slice(0, 500)
    if (props.node.prompt) return props.node.prompt.slice(0, 500)
    return null
  })

  const statusText = createMemo(() => {
    const status = props.node.status
    if (status === "running") return props.node.currentAction ?? "Processing..."
    if (status === "complete") return "Completed"
    if (status === "failed") return "Failed"
    return "Waiting..."
  })

  return (
    <div
      data-component="timeline-card"
      data-status={props.node.status}
      style={{ "--agent-color": agentColor() }}
      class={props.class}
      onClick={() => props.onSelect?.(props.node)}
    >
      {/* Preview Area */}
      <Show when={previewContent()}>
        <div data-slot="preview">
          <pre data-slot="preview-content">{previewContent()}</pre>
        </div>
      </Show>

      {/* Tool Chips */}
      <Show when={props.node.toolCalls && props.node.toolCalls.length > 0}>
        <div data-slot="tools">
          <For each={props.node.toolCalls?.slice(0, 8)}>
            {(tool) => (
              <span data-slot="tool-chip" data-status={tool.status}>
                <Show when={tool.status === "complete"}>
                  <Icon name="check" />
                </Show>
                <Show when={tool.status === "running"}>
                  <Spinner />
                </Show>
                <Show when={tool.status === "failed"}>
                  <Icon name="close" />
                </Show>
                <Show when={tool.status === "pending"}>
                  <Icon name="dot-grid" />
                </Show>
                {getToolSummary(tool)}
              </span>
            )}
          </For>
          <Show when={props.node.toolCalls && props.node.toolCalls.length > 8}>
            <span data-slot="tool-more">+{props.node.toolCalls!.length - 8}</span>
          </Show>
        </div>
      </Show>

      {/* Progress Bar (running only) */}
      <Show when={props.node.status === "running"}>
        <div data-slot="progress">
          <div data-slot="progress-bar" />
        </div>
      </Show>

      {/* Footer */}
      <div data-slot="footer">
        <span data-slot="agent-badge">@{props.node.agent}</span>
        <div data-slot="status-area">
          <span data-slot="status-pill">
            <span data-slot="status-icon">
              <Show when={props.node.status === "running"}><Spinner /></Show>
              <Show when={props.node.status === "complete"}><Icon name="check" /></Show>
              <Show when={props.node.status === "failed"}><Icon name="close" /></Show>
              <Show when={props.node.status === "pending"}><Icon name="dot-grid" /></Show>
            </span>
            {statusText()}
          </span>
          <Show when={duration()}>
            <span data-slot="duration">{duration()}</span>
          </Show>
        </div>
      </div>
    </div>
  )
}
