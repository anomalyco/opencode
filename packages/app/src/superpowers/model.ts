import { createSignal, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import {
  summarizeProgress,
  type Evidence,
  type Gate,
  type ProgressSummary,
  type RunEvent,
  type RunSnapshot,
  type Task,
} from "@bearmanser/opencode-superpowers-execution/contract"
import { projectAgentTree } from "./agent-tree"
import type { ExecutionScope } from "./identity"
import type { NativeRecord } from "./native-types"
import { ACCOUNTING_CURRENCY, sumUsageRecords, type UsageAggregate, type UsageRecord } from "./telemetry"

export const EXECUTION_SUBVIEWS = ["map", "agents", "tasks", "activity"] as const
export type ExecutionSubview = (typeof EXECUTION_SUBVIEWS)[number]

export type ExecutionMode = "observer" | "ready" | "stale" | "incompatible" | "unavailable"

export type ExecutionReason =
  | "plugin_absent"
  | "no_run"
  | "incompatible_schema"
  | "auth"
  | "offline"
  | "transport"

export function structuredViewsEnabled(mode: ExecutionMode) {
  return mode !== "incompatible"
}

export type ExecutionProgress = ProgressSummary

export type ExecutionRun = RunSnapshot

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

export type ExecutionAssignmentJoin = {
  id: string
  taskID: string
  attempt: number
  sessionID: string
  role: ExecutionAgentRole
  createdAt: number
  endedAt?: number
  active: boolean
  available: boolean
  sessionState?: ExecutionAgentState
  sessionTitle?: string
}

export type ExecutionTaskAssignments = {
  current: ExecutionAssignmentJoin[]
  history: ExecutionAssignmentJoin[]
  uniqueSessions: number
}

export type ExecutionEvidenceJoin = Evidence & {
  sessionTitle?: string
}

export type ExecutionTaskEvidence = {
  current: ExecutionEvidenceJoin[]
  superseded: ExecutionEvidenceJoin[]
}

export type EvidenceReference = {
  id: string
  sessionID: string
  messageID: string
  partID?: string
}

export type EvidenceResolution = "resolving" | "available" | "unavailable"

export type ExecutionActivityEvent = RunEvent & {
  taskTitle?: string
  sessionID?: string
  sessionTitle?: string
}

export type ExecutionActivityPage = {
  events: ExecutionActivityEvent[]
  total: number
  visible: number
  truncatedBeforeRevision?: number
  hasMore: boolean
}

export const ACTIVITY_PAGE_SIZE = 100

export type EvidenceResolver = (reference: Omit<EvidenceReference, "id">) => Promise<boolean> | boolean

export type EvidenceNavigator = (reference: EvidenceReference) => void

export function latestEvidenceForGate(evidence: ExecutionEvidenceJoin[], gate: Gate) {
  return evidence.filter((item) => item.gate === gate).at(-1)
}

export function evidenceAvailability(resolution: EvidenceResolution | undefined) {
  if (resolution === "available") return "true"
  if (resolution === "unavailable") return "false"
  return "unknown"
}

export function joinTaskAssignments(input: {
  run: RunSnapshot
  taskID: string
  attempt: number
  agents: ExecutionAgent[]
}): ExecutionTaskAssignments {
  const index = new Map(input.agents.map((agent) => [agent.id, agent]))
  const rows = input.run.assignments
    .filter((assignment) => assignment.taskID === input.taskID)
    .map((assignment) => {
      const agent = index.get(assignment.sessionID)
      return {
        id: assignment.id,
        taskID: assignment.taskID,
        attempt: assignment.attempt,
        sessionID: assignment.sessionID,
        role: assignment.role,
        createdAt: assignment.createdAt,
        endedAt: assignment.endedAt,
        active: assignment.endedAt === undefined,
        available: agent !== undefined,
        sessionState: agent?.state,
        sessionTitle: agent?.title,
      } satisfies ExecutionAssignmentJoin
    })
    .sort(compareByCreatedAt)
  return {
    current: rows.filter((row) => row.attempt === input.attempt),
    history: rows.filter((row) => row.attempt !== input.attempt),
    uniqueSessions: new Set(rows.map((row) => row.sessionID)).size,
  }
}

export function joinTaskEvidence(input: {
  run: RunSnapshot
  taskID: string
  attempt: number
  agents: ExecutionAgent[]
}): ExecutionTaskEvidence {
  const index = new Map(input.agents.map((agent) => [agent.id, agent]))
  const rows = input.run.evidence
    .filter((evidence) => evidence.taskID === input.taskID)
    .map((evidence) => {
      const agent = index.get(evidence.sessionID)
      return {
        ...evidence,
        sessionTitle: agent?.title,
      } satisfies ExecutionEvidenceJoin
    })
  return {
    current: rows.filter((row) => row.attempt === input.attempt),
    superseded: rows.filter((row) => row.attempt !== input.attempt),
  }
}

function compareByCreatedAt(left: { createdAt: number; id: string }, right: { createdAt: number; id: string }) {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
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
  snapshot?: Accessor<RunSnapshot | undefined>
  reason?: Accessor<ExecutionReason | undefined>
  agents?: Accessor<ExecutionAgent[]>
  nativeComplete?: Accessor<boolean | undefined>
  progress?: Accessor<ExecutionProgress | undefined>
  attention?: Accessor<ExecutionAttention>
  usage?: Accessor<UsageRecord[]>
  initialSubview?: ExecutionSubview
  openSession?: (sessionID: string) => void
  resolveEvidence?: EvidenceResolver
  navigateEvidence?: EvidenceNavigator
  retry?: (sessionID: string) => void
  reviewRequest?: () => void
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
  reason: Accessor<ExecutionReason | undefined>
  structured: Accessor<boolean>
  subview: Accessor<ExecutionSubview>
  selectedTaskID: Accessor<string | undefined>
  selectedTask: Accessor<Task | undefined>
  activity: Accessor<ExecutionActivityPage>
  activityUsage: Accessor<UsageAggregate>
  taskAssignments: (taskID: string, attempt: number) => ExecutionTaskAssignments
  taskEvidence: (taskID: string, attempt: number) => ExecutionTaskEvidence
  evidenceResolution: (evidenceID: string) => EvidenceResolution | undefined
  openEvidence: (reference: EvidenceReference) => void
  expanded: Accessor<boolean>
  attention: Accessor<ExecutionAttention>
  selectSubview: (subview: ExecutionSubview) => void
  selectTask: (taskID: string | undefined) => void
  selectRun: (runID: string | undefined) => void
  setExpanded: (expanded: boolean) => void
  loadMoreActivity: () => void
  isAgentExpanded: (sessionID: string) => boolean
  toggleAgentExpanded: (sessionID: string) => void
  isAssignmentHistoryExpanded: (sessionID: string) => boolean
  toggleAssignmentHistory: (sessionID: string) => void
  openSession: (sessionID: string) => void
  retryAgent: (sessionID: string) => void
  reviewRequest: () => void
  reconcile: () => void
}

const emptyAgents: ExecutionAgent[] = []
const emptyAttention: ExecutionAttention = { stale: false, needsInput: 0, failed: 0, blocked: 0 }

export function createExecutionModel(input: ExecutionModelInput = {}): ExecutionModel {
  const initialSubview = () => input.initialSubview ?? defaultSubview(input)
  const rootKey = () => `${input.scope?.()?.serverKey ?? ""}\u0000${input.scope?.()?.rootSessionID ?? ""}`
  const [subviewRoot, setSubviewRoot] = createSignal(rootKey())
  const [activeSubview, setActiveSubview] = createSignal<ExecutionSubview>(initialSubview())
  const [subviewMemory, setSubviewMemory] = createStore<Record<string, ExecutionSubview | undefined>>({})
  const subview = () =>
    subviewRoot() === rootKey() ? activeSubview() : (subviewMemory[rootKey()] ?? initialSubview())
  const selectSubview = (next: ExecutionSubview) => {
    if (subviewRoot() !== rootKey()) setSubviewRoot(rootKey())
    setActiveSubview(next)
    setSubviewMemory(rootKey(), next)
  }
  const [taskRoot, setTaskRoot] = createSignal(rootKey())
  const [activeTaskID, setActiveTaskID] = createSignal<string | undefined>()
  const [taskMemory, setTaskMemory] = createStore<Record<string, string | undefined>>({})
  const selectedTaskID = () => (taskRoot() === rootKey() ? activeTaskID() : taskMemory[rootKey()])
  const selectTask = (next: string | undefined) => {
    if (taskRoot() !== rootKey()) setTaskRoot(rootKey())
    setActiveTaskID(next)
    setTaskMemory(rootKey(), next)
  }
  let observedRoot = rootKey()
  let expandedRoot: string | undefined
  const [activeExpanded, setActiveExpanded] = createSignal(false)
  const expanded = () => {
    if (observedRoot !== rootKey()) {
      observedRoot = rootKey()
      expandedRoot = undefined
    }
    return activeExpanded() && expandedRoot === observedRoot
  }
  const setExpanded = (next: boolean) => {
    observedRoot = rootKey()
    expandedRoot = next ? observedRoot : undefined
    setActiveExpanded(next)
  }
  const [expandedNodes, setExpandedNodes] = createSignal<Record<string, boolean>>({})
  const [assignmentHistory, setAssignmentHistory] = createSignal<Record<string, boolean>>({})
  const [evidenceStates, setEvidenceStates] = createSignal<Record<string, EvidenceResolution>>({})
  const [activityPaging, setActivityPaging] = createStore({ key: "", count: ACTIVITY_PAGE_SIZE })

  const rawSnapshot = () => input.snapshot?.()
  const mode = () => input.mode?.() ?? (rawSnapshot() ? "ready" : "observer")
  const incompatible = () => mode() === "incompatible"
  const scope = () => input.scope?.()
  const snapshot = () => (incompatible() ? undefined : rawSnapshot())
  const run = () => {
    if (incompatible()) return undefined
    return input.run?.() ?? rawSnapshot()
  }
  const agents = () => input.agents?.() ?? emptyAgents
  const reason = () => input.reason?.()
  const structured = () => !incompatible() && (mode() === "ready" || mode() === "stale")
  const progress = () => {
    if (incompatible()) return undefined
    const explicit = input.progress?.()
    if (explicit) return explicit
    const current = rawSnapshot()
    return current ? summarizeProgress(current.tasks) : undefined
  }
  const attention = () => {
    const current = input.attention?.() ?? emptyAttention
    const currentSnapshot = incompatible() ? undefined : rawSnapshot()
    const derived = currentSnapshot ? summarizeProgress(currentSnapshot.tasks) : undefined
    return {
      stale: current.stale || mode() === "stale",
      needsInput: current.needsInput,
      failed: Math.max(current.failed, derived?.failed ?? 0),
      blocked: Math.max(current.blocked, derived?.blocked ?? 0),
    }
  }

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

  const selectedTask = () => {
    const current = run()
    return current?.tasks.find((task) => task.id === selectedTaskID())
  }

  const activityKey = () =>
    `${scope()?.serverKey ?? ""}\u0000${scope()?.rootSessionID ?? ""}\u0000${run()?.runID ?? ""}`

  const activityVisibleCount = () =>
    activityPaging.key === activityKey() ? activityPaging.count : ACTIVITY_PAGE_SIZE

  const activityEvents = (): ExecutionActivityEvent[] => {
    const current = run()
    if (!current) return []
    const agentsByID = new Map(agents().map((agent) => [agent.id, agent]))
    const tasksByID = new Map(current.tasks.map((task) => [task.id, task]))
    return current.events
      .map((event) => {
        const sessionID = activitySession(current, event)
        return {
          ...event,
          taskTitle: event.taskID ? tasksByID.get(event.taskID)?.title : undefined,
          sessionID,
          sessionTitle: sessionID ? agentsByID.get(sessionID)?.title : undefined,
        } satisfies ExecutionActivityEvent
      })
      .sort(compareActivityEvents)
      .reverse()
  }

  const activity = (): ExecutionActivityPage => {
    const events = activityEvents()
    const visible = activityVisibleCount()
    return {
      events: events.slice(0, visible),
      total: events.length,
      visible: Math.min(visible, events.length),
      truncatedBeforeRevision: run()?.historyTruncatedBeforeRevision,
      hasMore: events.length > visible,
    }
  }

  const loadMoreActivity = () =>
    setActivityPaging({ key: activityKey(), count: activityVisibleCount() + ACTIVITY_PAGE_SIZE })

  const activityUsage = (): UsageAggregate => {
    const currentScope = scope()
    const serverKey = currentScope?.serverKey ?? ""
    const sessions = agents().map((agent) => ({
      serverKey,
      sessionID: agent.id,
      parentSessionID: agent.parentID,
      currency: ACCOUNTING_CURRENCY,
      cost: agent.usage?.cost,
      tokens: agent.usage?.tokens,
    }) satisfies UsageRecord)
    return sumUsageRecords([...sessions, ...(input.usage?.() ?? [])], {
      serverKey,
      currency: ACCOUNTING_CURRENCY,
      complete: input.nativeComplete?.() ?? agentTree().complete,
    })
  }

  const taskAssignments = (taskID: string, attempt: number) => {
    const current = run()
    if (!current) return { current: [], history: [], uniqueSessions: 0 }
    return joinTaskAssignments({ run: current, taskID, attempt, agents: agents() })
  }

  const taskEvidence = (taskID: string, attempt: number) => {
    const current = run()
    if (!current) return { current: [], superseded: [] }
    return joinTaskEvidence({ run: current, taskID, attempt, agents: agents() })
  }

  const evidenceResolution = (evidenceID: string) => evidenceStates()[evidenceID]

  const openEvidence = (reference: EvidenceReference) => {
    if (evidenceStates()[reference.id] === "resolving") return
    const resolver = input.resolveEvidence
    if (!resolver) {
      input.navigateEvidence?.(reference)
      return
    }
    setEvidenceStates({ ...evidenceStates(), [reference.id]: "resolving" })
    Promise.resolve(resolver({ sessionID: reference.sessionID, messageID: reference.messageID, partID: reference.partID })).then(
      (resolved) => {
        setEvidenceStates((current) => ({ ...current, [reference.id]: resolved ? "available" : "unavailable" }))
        if (resolved) input.navigateEvidence?.(reference)
      },
      () => setEvidenceStates((current) => ({ ...current, [reference.id]: "unavailable" })),
    )
  }

  return {
    mode,
    scope,
    run,
    agents,
    agentTree,
    agentRows,
    progress,
    reason,
    structured,
    subview,
    selectedTaskID,
    selectedTask,
    activity,
    activityUsage,
    taskAssignments,
    taskEvidence,
    evidenceResolution,
    openEvidence,
    expanded,
    attention,
    selectSubview,
    selectTask,
    selectRun: (runID) => input.selectRun?.(runID),
    setExpanded,
    loadMoreActivity,
    isAgentExpanded,
    toggleAgentExpanded,
    isAssignmentHistoryExpanded,
    toggleAssignmentHistory,
    openSession: (sessionID) => input.openSession?.(sessionID),
    retryAgent: (sessionID) => input.retry?.(sessionID),
    reviewRequest: () => input.reviewRequest?.(),
    reconcile: () => input.reconcile?.(),
  }
}

export function selectNarrowExecutionSubview(model: ExecutionModel) {
  if (model.run() !== undefined && model.subview() === "map") model.selectSubview("tasks")
}

function controllerRank(rootSessionID: string | undefined, agent: ExecutionAgent) {
  return rootSessionID === agent.id ? 0 : 1
}

function activitySession(run: RunSnapshot, event: RunEvent) {
  if (!event.taskID) return run.rootSessionID
  if (event.type === "assignment.add") {
    return matchedAssignment(run, event.taskID, (assignment) => assignment.createdAt === event.createdAt)?.sessionID
  }
  if (event.type === "assignment.end") {
    return matchedAssignment(
      run,
      event.taskID,
      (assignment) => assignment.endedAt !== undefined && assignment.endedAt === event.createdAt,
    )?.sessionID
  }
  if (event.type === "evidence.add") {
    const matched = run.evidence.filter((item) => item.taskID === event.taskID && item.createdAt === event.createdAt)
    return matched.length === 1 ? matched[0]?.sessionID : undefined
  }
  return run.rootSessionID
}

function matchedAssignment(
  run: RunSnapshot,
  taskID: string,
  matches: (assignment: RunSnapshot["assignments"][number]) => boolean,
) {
  const matched = run.assignments.filter((assignment) => assignment.taskID === taskID).filter(matches)
  return matched.length === 1 ? matched[0] : undefined
}

function compareActivityEvents(left: RunEvent, right: RunEvent) {
  if (left.revision !== right.revision) return left.revision - right.revision
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
  if (left.type < right.type) return -1
  if (left.type > right.type) return 1
  return 0
}

function defaultSubview(input: ExecutionModelInput): ExecutionSubview {
  if (input.mode?.() === "incompatible") return "agents"
  return (input.run?.() ?? input.snapshot?.()) !== undefined ? "map" : "agents"
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
