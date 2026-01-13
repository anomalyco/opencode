import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AgentNode } from "@opencode-ai/ui/agent-flow-node"
import { onCleanup } from "solid-js"
import { useSDK } from "./sdk"

interface AgentFlowState {
  nodes: AgentNode[]
  selectedNodeId: string | null
}

function findAndUpdate(nodes: AgentNode[], id: string, updater: (node: AgentNode) => AgentNode): AgentNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return updater(node)
    }
    if (node.children) {
      return { ...node, children: findAndUpdate(node.children, id, updater) }
    }
    return node
  })
}

function findAndAddChild(nodes: AgentNode[], parentId: string, child: AgentNode): AgentNode[] {
  return nodes.map((node) => {
    if (node.id === parentId) {
      return { ...node, children: [...(node.children ?? []), child] }
    }
    if (node.children) {
      return { ...node, children: findAndAddChild(node.children, parentId, child) }
    }
    return node
  })
}

function findNodeById(nodes: AgentNode[], id: string): AgentNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
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

    const addNode = (node: AgentNode, parentId?: string) => {
      setState(
        produce((s) => {
          if (parentId) {
            s.nodes = findAndAddChild(s.nodes, parentId, node)
          } else {
            s.nodes.push(node)
          }
        }),
      )
    }

    const updateNode = (id: string, updates: Partial<AgentNode>) => {
      setState(
        produce((s) => {
          s.nodes = findAndUpdate(s.nodes, id, (node) => ({ ...node, ...updates }))
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

      if (existingNode) {
        // Update existing node
        const updates: Partial<AgentNode> = { status }
        if (status === "complete" || status === "failed") {
          updates.endTime = Date.now()
        }
        updateNode(part.id, updates)
      } else {
        // Create new node
        const node: AgentNode = {
          id: part.id,
          agent: subagentType,
          description: input.description ?? "Agent task",
          status,
          prompt: input.prompt,
          startTime: Date.now(),
        }

        // Get parent task ID from metadata if available
        const metadata = (toolState.status !== "pending" ? toolState.metadata : undefined) as
          | { parentTaskId?: string }
          | undefined
        addNode(node, metadata?.parentTaskId)
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
