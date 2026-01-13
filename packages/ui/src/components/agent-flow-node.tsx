import { Show, createSignal, For } from "solid-js"
import { Icon } from "./icon"
import { Spinner } from "./spinner"
import "./agent-flow-node.css"

export interface AgentNode {
  id: string
  agent: string
  description: string
  prompt?: string
  status: "pending" | "running" | "complete" | "failed"
  startTime?: number
  endTime?: number
  children?: AgentNode[]
  toolCalls?: {
    tool: string
    input: string
    output?: string
  }[]
}

export interface AgentFlowNodeProps {
  node: AgentNode
  depth?: number
  onSelect?: (node: AgentNode) => void
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

export function AgentFlowNode(props: AgentFlowNodeProps) {
  const [expanded, setExpanded] = createSignal(false)
  const depth = () => props.depth ?? 0

  const agentColor = () => AGENT_COLORS[props.node.agent] ?? "#666"

  const duration = () => {
    if (!props.node.startTime || !props.node.endTime) return null
    const ms = props.node.endTime - props.node.startTime
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div
      data-component="agent-flow-node"
      data-status={props.node.status}
      style={{ "--depth": depth(), "--agent-color": agentColor() }}
    >
      <div data-slot="connector">
        <Show when={depth() > 0}>
          <div data-slot="line" />
        </Show>
      </div>

      <div data-slot="content">
        <button
          data-slot="header"
          onClick={() => setExpanded(!expanded())}
          onDblClick={() => props.onSelect?.(props.node)}
        >
          <div data-slot="agent-badge">
            <span data-slot="agent-icon">@</span>
            <span data-slot="agent-name">{props.node.agent}</span>
          </div>

          <div data-slot="description">{props.node.description}</div>

          <div data-slot="meta">
            <Show when={duration()}>
              <span data-slot="duration">{duration()}</span>
            </Show>
            <Show when={props.node.status === "pending"}>
              <Icon name="dot-grid" data-slot="status-icon" />
            </Show>
            <Show when={props.node.status === "running"}>
              <div data-slot="status-icon">
                <Spinner />
              </div>
            </Show>
            <Show when={props.node.status === "complete"}>
              <Icon name="circle-check" data-slot="status-icon" />
            </Show>
            <Show when={props.node.status === "failed"}>
              <Icon name="circle-x" data-slot="status-icon" />
            </Show>
            <Icon
              name="chevron-down"
              data-slot="expand-icon"
              data-expanded={expanded() ? "" : undefined}
            />
          </div>
        </button>

        <Show when={expanded()}>
          <div data-slot="details">
            <Show when={props.node.prompt}>
              <div data-slot="prompt-section">
                <div data-slot="section-label">Prompt</div>
                <pre data-slot="prompt-content">{props.node.prompt}</pre>
              </div>
            </Show>

            <Show when={props.node.toolCalls?.length}>
              <div data-slot="tools-section">
                <div data-slot="section-label">Tool Calls</div>
                <For each={props.node.toolCalls}>
                  {(call) => (
                    <div data-slot="tool-call">
                      <span data-slot="tool-name">{call.tool}</span>
                      <pre data-slot="tool-input">{call.input}</pre>
                      <Show when={call.output}>
                        <pre data-slot="tool-output">{call.output}</pre>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={props.node.children?.length}>
          <div data-slot="children">
            <For each={props.node.children}>
              {(child) => (
                <AgentFlowNode
                  node={child}
                  depth={depth() + 1}
                  onSelect={props.onSelect}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
