import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AgentNode } from "@opencode-ai/ui/agent-flow-node"

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

export const { use: useAgentFlow, provider: AgentFlowProvider } = createSimpleContext({
  name: "AgentFlow",
  gate: false,
  init: () => {
    const [state, setState] = createStore<AgentFlowState>({
      nodes: [],
      selectedNodeId: null,
    })

    return {
      nodes: () => state.nodes,
      selectedNodeId: () => state.selectedNodeId,

      addNode: (node: AgentNode, parentId?: string) => {
        setState(
          produce((s) => {
            if (parentId) {
              s.nodes = findAndAddChild(s.nodes, parentId, node)
            } else {
              s.nodes.push(node)
            }
          }),
        )
      },

      updateNode: (id: string, updates: Partial<AgentNode>) => {
        setState(
          produce((s) => {
            s.nodes = findAndUpdate(s.nodes, id, (node) => ({ ...node, ...updates }))
          }),
        )
      },

      selectNode: (id: string | null) => {
        setState("selectedNodeId", id)
      },

      clear: () => {
        setState({ nodes: [], selectedNodeId: null })
      },
    }
  },
})
