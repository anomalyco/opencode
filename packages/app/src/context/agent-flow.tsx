import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AgentFlowNode, ToolCall } from "@opencode-ai/ui/agent-flow-graph"
import { onCleanup, createEffect } from "solid-js"
import { useSDK } from "./sdk"

interface AgentFlowState {
  nodes: AgentFlowNode[]
  selectedNodeId: string | null
  sessionId: string | null
}

// Storage key for persistence
const STORAGE_KEY = "agent-flow-state"

function loadPersistedState(sessionId: string): AgentFlowNode[] {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY}-${sessionId}`)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error("Failed to load agent flow state:", e)
  }
  return []
}

function persistState(sessionId: string, nodes: AgentFlowNode[]) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${sessionId}`, JSON.stringify(nodes))
  } catch (e) {
    console.error("Failed to persist agent flow state:", e)
  }
}

function findNodeById(nodes: AgentFlowNode[], id: string): AgentFlowNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
  }
  return undefined
}

function getToolSummary(tool: string, input: string): string {
  if (tool === "Read" || tool === "read") {
    const match = input.match(/file_path["\s:]+["']?([^"'\s,}]+)/)
    return match ? match[1].split("/").pop() ?? "" : ""
  }
  if (tool === "Edit" || tool === "edit") {
    const match = input.match(/file_path["\s:]+["']?([^"'\s,}]+)/)
    return match ? match[1].split("/").pop() ?? "" : ""
  }
  if (tool === "Bash" || tool === "bash") {
    const match = input.match(/command["\s:]+["']?([^"'\n]{0,20})/)
    return match ? match[1].trim() : ""
  }
  return ""
}

export const { use: useAgentFlow, provider: AgentFlowProvider } = createSimpleContext({
  name: "AgentFlow",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const [state, setState] = createStore<AgentFlowState>({
      nodes: [],
      selectedNodeId: null,
      sessionId: null,
    })

    // Track active task IDs to their parent task IDs
    const taskParentMap = new Map<string, string>()

    const addNode = (node: AgentFlowNode) => {
      setState(
        produce((s) => {
          s.nodes.push(node)
        }),
      )
    }

    const updateNode = (id: string, updates: Partial<AgentFlowNode>) => {
      setState(
        produce((s) => {
          const idx = s.nodes.findIndex((n) => n.id === id)
          if (idx >= 0) {
            s.nodes[idx] = { ...s.nodes[idx], ...updates }
          }
        }),
      )
    }

    const addToolCall = (nodeId: string, toolCall: ToolCall) => {
      setState(
        produce((s) => {
          const idx = s.nodes.findIndex((n) => n.id === nodeId)
          if (idx >= 0) {
            const node = s.nodes[idx]
            const toolCalls = node.toolCalls ?? []
            const existingIdx = toolCalls.findIndex((t) => t.id === toolCall.id)
            if (existingIdx >= 0) {
              toolCalls[existingIdx] = toolCall
            } else {
              toolCalls.push(toolCall)
            }
            s.nodes[idx] = { ...node, toolCalls }
          }
        }),
      )
    }

    // Persist state when it changes
    createEffect(() => {
      const sessionId = state.sessionId
      const nodes = state.nodes
      if (sessionId && nodes.length > 0) {
        persistState(sessionId, nodes)
      }
    })

    // Listen for events from the SDK
    const unsub = sdk.event.listen((e) => {
      const event = e.details

      // Track session changes
      if (event.type === "session.created" || event.type === "session.updated") {
        const sessionId = event.properties.info?.id
        if (sessionId && sessionId !== state.sessionId) {
          // Load persisted state for this session
          const persisted = loadPersistedState(sessionId)
          setState({
            nodes: persisted,
            selectedNodeId: null,
            sessionId,
          })
        }
      }

      // Handle session.status to create planner node immediately
      if (event.type === "session.status") {
        const sessionId = event.properties.sessionID
        const status = event.properties.status

        // Session started - create planner root node
        if (status.type === "busy" && sessionId === state.sessionId) {
          const plannerId = `planner-${sessionId}`
          const existingPlanner = findNodeById(state.nodes, plannerId)
          if (!existingPlanner) {
            const plannerNode: AgentFlowNode = {
              id: plannerId,
              agent: "planner",
              description: "Processing request...",
              status: "running",
              currentAction: "Analyzing prompt...",
              startTime: Date.now(),
              toolCalls: [],
            }
            addNode(plannerNode)
          }
        }

        // Session became idle - mark planner complete
        if (status.type === "idle" && sessionId === state.sessionId) {
          const plannerId = `planner-${sessionId}`
          const plannerNode = findNodeById(state.nodes, plannerId)
          if (plannerNode && plannerNode.status === "running") {
            updateNode(plannerId, {
              status: "complete",
              currentAction: "Completed",
              endTime: Date.now(),
            })
          }
        }
      }

      if (event.type !== "message.part.updated") return

      const part = event.properties.part

      // Handle task tool (agent spawning)
      if (part.type === "tool" && part.tool === "task") {
        const toolState = part.state
        const input = toolState.input as { subagent_type?: string; description?: string; prompt?: string }
        const subagentType = input.subagent_type
        if (!subagentType) return

        const existingNode = findNodeById(state.nodes, part.id)

        const status =
          toolState.status === "completed"
            ? "complete"
            : toolState.status === "error"
              ? "failed"
              : toolState.status === "running"
                ? "running"
                : "pending"

        const output = toolState.status === "completed" || toolState.status === "error"
          ? (toolState as { output?: string }).output
          : undefined

        const currentAction = status === "running"
          ? input.description ?? "Processing..."
          : status === "complete"
            ? "Completed"
            : status === "failed"
              ? "Failed"
              : "Waiting..."

        // Get parent task ID from metadata
        const metadata = (toolState.status !== "pending" ? toolState.metadata : undefined) as
          | { parentTaskId?: string }
          | undefined

        if (existingNode) {
          const previousAction = existingNode.currentAction !== currentAction
            ? existingNode.currentAction
            : existingNode.previousAction

          updateNode(part.id, {
            status,
            previousAction,
            currentAction,
            output,
            endTime: status === "complete" || status === "failed" ? Date.now() : undefined,
          })
        } else {
          // Link to planner node if no explicit parent
          const parentId = metadata?.parentTaskId ?? (state.sessionId ? `planner-${state.sessionId}` : undefined)

          const node: AgentFlowNode = {
            id: part.id,
            agent: subagentType,
            description: input.description ?? "Agent task",
            status,
            prompt: input.prompt,
            currentAction,
            startTime: Date.now(),
            parentId,
            toolCalls: [],
          }

          // Store parent relationship for child tasks
          if (parentId) {
            taskParentMap.set(part.id, parentId)
          }

          addNode(node)
        }
      }

      // Handle other tool calls (non-task tools)
      if (part.type === "tool" && part.tool !== "task") {
        const toolState = part.state

        // Find the most recent running agent to attribute this tool call to
        const runningAgents = state.nodes.filter((n) => n.status === "running")
        const parentAgent = runningAgents[runningAgents.length - 1]

        if (parentAgent) {
          const inputStr = typeof toolState.input === "string" ? toolState.input : JSON.stringify(toolState.input)
          const toolCall: ToolCall = {
            id: part.id,
            tool: part.tool,
            status: toolState.status === "completed"
              ? "complete"
              : toolState.status === "error"
                ? "failed"
                : toolState.status === "running"
                  ? "running"
                  : "pending",
            input: inputStr,
            output: toolState.status === "completed"
              ? (toolState as { output?: string }).output
              : undefined,
            summary: getToolSummary(part.tool, inputStr),
          }
          addToolCall(parentAgent.id, toolCall)
        }
      }
    })

    onCleanup(unsub)

    return {
      nodes: () => state.nodes,
      selectedNodeId: () => state.selectedNodeId,
      sessionId: () => state.sessionId,

      // Load state for a specific session
      loadSession: (sessionId: string) => {
        const persisted = loadPersistedState(sessionId)
        setState({
          nodes: persisted,
          selectedNodeId: null,
          sessionId,
        })
      },

      addNode,
      updateNode,
      addToolCall,

      selectNode: (id: string | null) => {
        setState("selectedNodeId", id)
      },

      clear: () => {
        setState({ nodes: [], selectedNodeId: null })
        if (state.sessionId) {
          localStorage.removeItem(`${STORAGE_KEY}-${state.sessionId}`)
        }
      },
    }
  },
})
