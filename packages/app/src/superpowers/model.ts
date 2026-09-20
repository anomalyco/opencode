import { createMemo, createSignal, type Accessor } from "solid-js"
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
export type ExecutionAgent = NativeRecord & { state: ExecutionAgentState }

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
  selectRun?: (runID: string | undefined) => void
  reconcile?: () => void
}

export type ExecutionModel = {
  mode: Accessor<ExecutionMode>
  scope: Accessor<ExecutionScope | undefined>
  run: Accessor<ExecutionRun | undefined>
  agents: Accessor<ExecutionAgent[]>
  progress: Accessor<ExecutionProgress | undefined>
  subview: Accessor<ExecutionSubview>
  selectedTaskID: Accessor<string | undefined>
  expanded: Accessor<boolean>
  attention: Accessor<ExecutionAttention>
  selectSubview: (subview: ExecutionSubview) => void
  selectTask: (taskID: string | undefined) => void
  selectRun: (runID: string | undefined) => void
  setExpanded: (expanded: boolean) => void
  openSession: (sessionID: string) => void
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

  const mode = createMemo(() => input.mode?.() ?? "observer")
  const scope = createMemo(() => input.scope?.())
  const run = createMemo(() => input.run?.())
  const agents = createMemo(() => input.agents?.() ?? emptyAgents)
  const progress = createMemo(() => input.progress?.())
  const attention = createMemo(() => input.attention?.() ?? emptyAttention)

  return {
    mode,
    scope,
    run,
    agents,
    progress,
    subview,
    selectedTaskID,
    expanded,
    attention,
    selectSubview: setSubview,
    selectTask: setSelectedTaskID,
    selectRun: (runID) => input.selectRun?.(runID),
    setExpanded,
    openSession: (sessionID) => input.openSession?.(sessionID),
    reconcile: () => input.reconcile?.(),
  }
}
