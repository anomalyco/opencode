import { Show, createMemo } from "solid-js"
import { Icon } from "./icon"
import { Spinner } from "./spinner"
import "./agent-card.css"

export interface AgentCardNode {
  id: string
  agent: string
  description: string
  prompt?: string
  status: "pending" | "running" | "complete" | "failed"
  currentAction?: string
  previousAction?: string
  output?: string
  startTime?: number
  endTime?: number
}

export interface AgentCardProps {
  node: AgentCardNode
  onSelect?: (node: AgentCardNode) => void
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

export function AgentCard(props: AgentCardProps) {
  const agentColor = () => AGENT_COLORS[props.node.agent] ?? "#666"

  const timeAgo = createMemo(() => {
    const time = props.node.endTime ?? props.node.startTime
    if (!time) return null
    const seconds = Math.floor((Date.now() - time) / 1000)
    if (seconds < 60) return `${seconds} seconds ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
    return `${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) > 1 ? "s" : ""} ago`
  })

  const statusText = createMemo(() => {
    const action = props.node.currentAction ?? props.node.description
    switch (props.node.status) {
      case "pending":
        return "Waiting..."
      case "running":
        return action
      case "complete":
        return "Completed"
      case "failed":
        return "Failed"
    }
  })

  return (
    <div
      data-component="agent-card"
      data-status={props.node.status}
      style={{ "--agent-color": agentColor() }}
      onClick={() => props.onSelect?.(props.node)}
    >
      {/* Background preview content */}
      <div data-slot="preview">
        <Show when={props.node.output}>
          <div data-slot="preview-content">{props.node.output}</div>
        </Show>
        <Show when={!props.node.output && props.node.prompt}>
          <div data-slot="preview-content">{props.node.prompt}</div>
        </Show>
      </div>

      {/* Status pill overlay */}
      <div data-slot="status-pill">
        <Show when={props.node.previousAction}>
          <span data-slot="previous-action">{props.node.previousAction}</span>
        </Show>
        <span data-slot="current-action">
          <span data-slot="status-indicator">
            <Show when={props.node.status === "running"}>
              <Spinner />
            </Show>
            <Show when={props.node.status === "complete"}>
              <Icon name="check" />
            </Show>
            <Show when={props.node.status === "failed"}>
              <Icon name="close" />
            </Show>
            <Show when={props.node.status === "pending"}>
              <Icon name="dot-grid" />
            </Show>
          </span>
          {statusText()}
        </span>
      </div>

      {/* Card footer */}
      <div data-slot="footer">
        <div data-slot="info">
          <span data-slot="agent-badge">@{props.node.agent}</span>
          <span data-slot="title">{props.node.description}</span>
        </div>
        <Show when={timeAgo()}>
          <span data-slot="timestamp">Updated {timeAgo()}</span>
        </Show>
      </div>

      {/* Menu button */}
      <button data-slot="menu-button" onClick={(e) => e.stopPropagation()}>
        <Icon name="menu" />
      </button>
    </div>
  )
}
