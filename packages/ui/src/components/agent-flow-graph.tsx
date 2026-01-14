
export interface ToolCall {
  id: string
  tool: string
  status: "pending" | "running" | "complete" | "failed"
  input: string
  output?: string
  summary?: string
}

export interface AgentFlowNode {
  id: string
  agent: string
  description: string
  status: "pending" | "running" | "complete" | "failed"
  currentAction?: string
  previousAction?: string
  startTime?: number
  endTime?: number
  parentId?: string
  prompt?: string
  output?: string
  thumbnail?: {
    content: string
  }
  toolCalls?: ToolCall[]
}

export interface AgentFlowGraphProps {
  nodes: AgentFlowNode[]
  prompt?: string
  onSelectNode?: (node: AgentFlowNode) => void
  class?: string
}

// Placeholder component - will be implemented when needed
export function AgentFlowGraph(props: AgentFlowGraphProps) {
  return (
    <div data-component="agent-flow-graph" class={props.class}>
      {/* Graph visualization placeholder */}
    </div>
  )
}

// Re-export for convenience
export type { AgentFlowNode as AgentNode }
