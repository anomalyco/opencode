import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AgentCardNode } from "@opencode-ai/ui/agent-card"
import { onCleanup } from "solid-js"
import { useSDK } from "./sdk"

interface AgentFlowState {
  nodes: AgentCardNode[]
  selectedNodeId: string | null
}

function findNodeById(nodes: AgentCardNode[], id: string): AgentCardNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
  }
  return undefined
}

export const { use: useAgentFlow, provider: AgentFlowProvider } = createSimpleContext({
  name: "AgentFlow",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const [state, setState] = createStore<AgentFlowState>({
      nodes: [],
      selectedNodeId: null,
    })

    const addNode = (node: AgentCardNode) => {
      setState(
        produce((s) => {
          s.nodes.push(node)
        }),
      )
    }

    const updateNode = (id: string, updates: Partial<AgentCardNode>) => {
      setState(
        produce((s) => {
          const idx = s.nodes.findIndex((n) => n.id === id)
          if (idx >= 0) {
            s.nodes[idx] = { ...s.nodes[idx], ...updates }
          }
        }),
      )
    }

    // Listen for task tool events from the SDK
    const unsub = sdk.event.listen((e) => {
      const event = e.details
      if (event.type !== "message.part.updated") return

      const part = event.properties.part
      if (part.type !== "tool" || part.tool !== "task") return

      const toolState = part.state
      const input = toolState.input as { subagent_type?: string; description?: string; prompt?: string }
      const subagentType = input.subagent_type
      if (!subagentType) return

      // Check if node already exists
      const existingNode = findNodeById(state.nodes, part.id)

      // Map tool status to agent node status
      const status =
        toolState.status === "completed"
          ? "complete"
          : toolState.status === "error"
            ? "failed"
            : toolState.status === "running"
              ? "running"
              : "pending"

      // Extract output if available
      const output = toolState.status === "completed" || toolState.status === "error"
        ? (toolState as { output?: string }).output
        : undefined

      // Determine current action based on status and tool activity
      const currentAction = status === "running"
        ? input.description ?? "Processing..."
        : status === "complete"
          ? "Completed"
          : status === "failed"
            ? "Failed"
            : "Waiting..."

      if (existingNode) {
        // Update existing node - track previous action
        const updates: Partial<AgentCardNode> = {
          status,
          currentAction,
          previousAction: existingNode.currentAction !== currentAction ? existingNode.currentAction : existingNode.previousAction,
        }
        if (status === "complete" || status === "failed") {
          updates.endTime = Date.now()
          updates.output = output
        }
        updateNode(part.id, updates)
      } else {
        // Create new node
        const node: AgentCardNode = {
          id: part.id,
          agent: subagentType,
          description: input.description ?? "Agent task",
          status,
          prompt: input.prompt,
          currentAction,
          startTime: Date.now(),
        }
        addNode(node)
      }
    })

    onCleanup(unsub)

    return {
      nodes: () => state.nodes,
      selectedNodeId: () => state.selectedNodeId,
      addNode,
      updateNode,

      selectNode: (id: string | null) => {
        setState("selectedNodeId", id)
      },

      clear: () => {
        setState({ nodes: [], selectedNodeId: null })
      },
    }
  },
})
