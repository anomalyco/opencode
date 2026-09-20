import { createSignal, type Accessor } from "solid-js"
import { projectAgentTree } from "./agent-tree"
import type { ExecutionScope } from "./identity"
import type { NativeRecord } from "./native-types"

export const EXECUTION_SUBVIEWS = ["map", "agents", "tasks", "activity"] as const
export type ExecutionSubview = (typeof EXECUTION_SUBVIEWS)[number]

export type ExecutionMode = "observer" | "ready" | "stale" | "incompatible" | "unavailable"

export type ExecutionProgress = {
  verified: number
  total: number
  skipped: number
  failed: number
  blocked: number
  awaitingReview: number
  percent: number | null
  source: "controller_report"
}

export type ExecutionRun = {
  runID: string
  rootSessionID: string
  ownerDirectory: string
  revision: number
  status: "active" | "completed" | "cancelled"
  title?: string
}

export type ExecutionAgentState = "running" | "idle" | "needs_input" | "error" | "unknown"
export type ExecutionAgentRole = "controller" | "implementer" | "spec_reviewer" | "code_reviewer" | "debugger"

export type ExecutionAssignment = {
  id: string
  taskID: string
  taskTitle?: string
  role: ExecutionAgentRole
  attempt: number
  active: boolean
}

export type ExecutionAgent = NativeRecord & {
  state: ExecutionAgentState
  assignments?: ExecutionAssignment[]
}

export type ExecutionAgentTree = {
  rootSessionID?: string
  nodes: ExecutionAgent[]
  complete: boolean
  missingParentID?: string
}

export type ExecutionAgentRow = {
  agent: ExecutionAgent
  level: number
  position: number
  setSize: number
  parentID?: string
  hasChildren: boolean
  expanded: boolean
  controller: boolean
}

export const AGENT_ROWS_VIRTUALIZE_THRESHOLD = 100

export type ExecutionAttention = {
  stale: boolean
  needsInput: number
  failed: number
  blocked: number
}

export type ExecutionModelInput = {
  mode?: Accessor<ExecutionMode>
  scope?: Accessor<ExecutionScope | undefined>
  run?: Accessor<ExecutionRun | undefined>
  agents?: Accessor<ExecutionAgent[]>
  progress?: Accessor<ExecutionProgress | undefined>
  attention?: Accessor<ExecutionAttention>
  initialSubview?: ExecutionSubview
  openSession?: (sessionID: string) => void
  retry?: (sessionID: string) => void
  selectRun?: (runID: string | undefined) => void
  reconcile?: () => void
}

export type ExecutionModel = {
  mode: Accessor<ExecutionMode>
  scope: Accessor<ExecutionScope | undefined>
  run: Accessor<ExecutionRun | undefined>
  agents: Accessor<ExecutionAgent[]>
  agentTree: Accessor<ExecutionAgentTree>
  agentRows: Accessor<ExecutionAgentRow[]>
  progress: Accessor<ExecutionProgress | undefined>
  subview: Accessor<ExecutionSubview>
  selectedTaskID: Accessor<string | undefined>
  expanded: Accessor<boolean>
  attention: Accessor<ExecutionAttention>
  selectSubview: (subview: ExecutionSubview) => void
  selectTask: (taskID: string | undefined) => void
  selectRun: (runID: string | undefined) => void
  setExpanded: (expanded: boolean) => void
  isAgentExpanded: (sessionID: string) => boolean
  toggleAgentExpanded: (sessionID: string) => void
  isAssignmentHistoryExpanded: (sessionID: string) => boolean
  toggleAssignmentHistory: (sessionID: string) => void
  openSession: (sessionID: string) => void
  retryAgent: (sessionID: string) => void
  reconcile: () => void
}

const emptyAgents: ExecutionAgent[] = []
const emptyAttention: ExecutionAttention = { stale: false, needsInput: 0, failed: 0, blocked: 0 }

export function createExecutionModel(input: ExecutionModelInput = {}): ExecutionModel {
  const [subview, setSubview] = createSignal<ExecutionSubview>(
    input.initialSubview ?? (input.run?.() ? "map" : "agents"),
  )
  const [selectedTaskID, setSelectedTaskID] = createSignal<string | undefined>()
  const [expanded, setExpanded] = createSignal(false)
  const [expandedNodes, setExpandedNodes] = createSignal<Record<string, boolean>>({})
  const [assignmentHistory, setAssignmentHistory] = createSignal<Record<string, boolean>>({})

  const mode = () => input.mode?.() ?? "observer"
  const scope = () => input.scope?.()
  const run = () => input.run?.()
  const agents = () => input.agents?.() ?? emptyAgents
  const progress = () => input.progress?.()
  const attention = () => input.attention?.() ?? emptyAttention

  const nodeKey = (sessionID: string) => {
    const current = scope()
    if (!current) return sessionID
    return `${current.serverKey}::${current.rootSessionID}::${sessionID}`
  }

  const agentTree = (): ExecutionAgentTree => {
    const current = agents()
    const selected = scope()?.rootSessionID ?? current[0]?.id
    if (!selected) return { nodes: [], complete: false }
    const byID = new Map(current.map((agent) => [agent.id, agent]))
    const projected = projectAgentTree(selected, current)
    return {
      rootSessionID: projected.rootSessionID,
      nodes: projected.nodes.flatMap((node) => {
        const agent = byID.get(node.id)
        return agent ? [agent] : []
      }),
      complete: projected.complete,
      missingParentID: projected.missingParentID,
    }
  }

  const isAgentExpanded = (sessionID: string) => {
    const stored = expandedNodes()[nodeKey(sessionID)]
    return stored ?? agentTree().rootSessionID === sessionID
  }

  const toggleAgentExpanded = (sessionID: string) => {
    const key = nodeKey(sessionID)
    const next = !(expandedNodes()[key] ?? agentTree().rootSessionID === sessionID)
    setExpandedNodes({ ...expandedNodes(), [key]: next })
  }

  const isAssignmentHistoryExpanded = (sessionID: string) => assignmentHistory()[nodeKey(sessionID)] ?? false

  const toggleAssignmentHistory = (sessionID: string) => {
    const key = nodeKey(sessionID)
    setAssignmentHistory({ ...assignmentHistory(), [key]: !assignmentHistory()[key] })
  }

  const agentRows = (): ExecutionAgentRow[] => {
    const tree = agentTree()
    const byID = new Map(tree.nodes.map((node) => [node.id, node]))
    const children = new Map<string, ExecutionAgent[]>()
    for (const node of tree.nodes) {
      if (!node.parentID || !byID.has(node.parentID)) continue
      const list = children.get(node.parentID)
      if (list) list.push(node)
      if (!list) children.set(node.parentID, [node])
    }
    for (const list of children.values()) list.sort(compareAgents)

    const roots = tree.nodes.filter((node) => !node.parentID || !byID.has(node.parentID))
    roots.sort((a, b) => controllerRank(tree.rootSessionID, a) - controllerRank(tree.rootSessionID, b) || compareAgents(a, b))

    const rows: ExecutionAgentRow[] = []
    const walk = (agent: ExecutionAgent, level: number, position: number, setSize: number) => {
      const descendants = children.get(agent.id) ?? []
      const hasChildren = descendants.length > 0
      const open = hasChildren && isAgentExpanded(agent.id)
      rows.push({
        agent,
        level,
        position,
        setSize,
        parentID: agent.parentID,
        hasChildren,
        expanded: open,
        controller: tree.rootSessionID === agent.id,
      })
      if (!open) return
      descendants.forEach((child, index) => walk(child, level + 1, index + 1, descendants.length))
    }
    roots.forEach((root, index) => walk(root, 1, index + 1, roots.length))
    return rows
  }

  return {
    mode,
    scope,
    run,
    agents,
    agentTree,
    agentRows,
    progress,
    subview,
    selectedTaskID,
    expanded,
    attention,
    selectSubview: setSubview,
    selectTask: setSelectedTaskID,
    selectRun: (runID) => input.selectRun?.(runID),
    setExpanded,
    isAgentExpanded,
    toggleAgentExpanded,
    isAssignmentHistoryExpanded,
    toggleAssignmentHistory,
    openSession: (sessionID) => input.openSession?.(sessionID),
    retryAgent: (sessionID) => input.retry?.(sessionID),
    reconcile: () => input.reconcile?.(),
  }
}

function controllerRank(rootSessionID: string | undefined, agent: ExecutionAgent) {
  return rootSessionID === agent.id ? 0 : 1
}

function compareAgents(a: ExecutionAgent, b: ExecutionAgent) {
  const left = a.title || a.id
  const right = b.title || b.id
  if (left < right) return -1
  if (left > right) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}
