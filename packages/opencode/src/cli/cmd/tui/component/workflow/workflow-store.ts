import { createStore } from "solid-js/store"

export type WorkerState = {
  sessionID: string
  agent: string
  startedAt: number
  status: "running" | "completed" | "failed"
  ok?: boolean
  error?: string
  prompt?: string
  batch?: number
  cost?: number
  tokens?: number
  escalation?: "retry"
}

export type WorkflowState = {
  workers: Record<string, WorkerState>
  verbosity: "minimal" | "normal" | "verbose"
  overviewOpen: boolean
  taskPanelOpen: boolean
  failedFirst: boolean
  activeHistory: number[]
  lastProgress: { done: number; total: number; active: number }
}

const MAX_HISTORY = 60

export const [workflowStore, setWorkflowStore] = createStore<Record<string, WorkflowState>>({})

export function initEntry(parentSessionID: string): WorkflowState {
  const entry: WorkflowState = {
    workers: {},
    verbosity: "normal",
    overviewOpen: false,
    taskPanelOpen: false,
    failedFirst: false,
    activeHistory: [],
    lastProgress: { done: 0, total: 0, active: 0 },
  }
  setWorkflowStore(parentSessionID, entry)
  return entry
}

export function resetWorkflow(parentSessionID: string) {
  setWorkflowStore(parentSessionID, undefined as unknown as WorkflowState)
}

export function ensureEntry(parentSessionID: string): WorkflowState {
  const existing = workflowStore[parentSessionID]
  if (existing) return existing
  return initEntry(parentSessionID)
}

export function pruneIfEmpty(parentSessionID: string) {
  const entry = workflowStore[parentSessionID]
  if (!entry) return
  if (Object.keys(entry.workers).length === 0 && !entry.overviewOpen && !entry.taskPanelOpen) {
    setWorkflowStore(parentSessionID, undefined as unknown as WorkflowState)
  }
}

export function cycleVerbosity(parentSessionID: string) {
  const entry = ensureEntry(parentSessionID)
  const next = entry.verbosity === "minimal" ? "normal" : entry.verbosity === "normal" ? "verbose" : "minimal"
  setWorkflowStore(parentSessionID, "verbosity", next)
}

export function toggleFailedFirst(parentSessionID: string) {
  const entry = ensureEntry(parentSessionID)
  setWorkflowStore(parentSessionID, "failedFirst", !entry.failedFirst)
}

export function toggleTaskPanel(parentSessionID: string) {
  const entry = ensureEntry(parentSessionID)
  setWorkflowStore(parentSessionID, "taskPanelOpen", !entry.taskPanelOpen)
}

export function pushActiveHistory(parentSessionID: string, count: number) {
  const entry = ensureEntry(parentSessionID)
  const next = [...entry.activeHistory, count]
  if (next.length > MAX_HISTORY) next.shift()
  setWorkflowStore(parentSessionID, "activeHistory", next)
}

export * as WorkflowStore from "./workflow-store"