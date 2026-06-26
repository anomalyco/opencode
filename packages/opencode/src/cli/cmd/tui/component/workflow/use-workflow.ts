import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { useSync } from "@tui/context/sync"
import {
  workflowStore,
  ensureEntry,
  pruneIfEmpty,
  pushActiveHistory,
  type WorkflowState,
} from "./workflow-store"
import type { Session, ToolPart, AssistantMessage, TextPart, UserMessage, Todo } from "@opencode-ai/sdk/v2"

export type WorkerInfo = {
  session: Session
  status: "running" | "completed" | "failed"
  error?: string
  prompt: string
  cost: number
  tokens: number
  batch: number
  escalation?: "retry"
  retryNext?: number
  retryAttempt?: number
}

export type CurrentTool = {
  tool: string
  title?: string
} | null

export type Batch = {
  index: number
  workerIDs: string[]
  status: "running" | "done" | "failed"
}

export type WorkflowDerived = {
  workers: () => WorkerInfo[]
  inFlight: () => WorkerInfo[]
  completed: () => WorkerInfo[]
  failed: () => WorkerInfo[]
  ratio: () => { done: number; total: number }
  progressRatio: () => { done: number; total: number }
  active: () => boolean
  allIdle: () => boolean
  state: () => WorkflowState | undefined
  batches: () => Batch[]
  failedSorted: () => WorkerInfo[]
  orchestratorThinking: () => string | undefined
  aggregateDiff: () => { added: number; removed: number; files: number }
  latestTodos: () => Todo[]
}

const BATCH_GAP_MS = 800
const PROMPT_MAX = 200

const activeHistorySamplers = new Map<string, () => void>()
const activeCountGetters = new Map<string, () => number>()

function startActiveHistorySampling(parentSessionID: string, inFlight: () => WorkerInfo[]) {
  activeCountGetters.set(parentSessionID, () => inFlight().length)
  if (activeHistorySamplers.has(parentSessionID)) return
  const tick = () => {
    const getter = activeCountGetters.get(parentSessionID)
    if (!getter) return
    pushActiveHistory(parentSessionID, getter())
  }
  tick()
  const timer = setInterval(tick, 1000)
  const stop = () => {
    clearInterval(timer)
    activeHistorySamplers.delete(parentSessionID)
    activeCountGetters.delete(parentSessionID)
  }
  activeHistorySamplers.set(parentSessionID, stop)
}

export function useWorkflow(parentSessionID: Accessor<string | undefined>): WorkflowDerived {
  const sync = useSync()

  const children = createMemo(() => {
    const id = parentSessionID()
    if (!id) return [] as Session[]
    return sync.data.session.filter((s) => s.parentID === id).toSorted((a, b) => a.time.created - b.time.created)
  })

  const childStatus = (sessionID: string) => sync.data.session_status[sessionID]?.type ?? "idle"

  const messagesOf = (sessionID: string) => sync.data.message[sessionID] ?? []

  const lastAssistant = (sessionID: string): AssistantMessage | undefined =>
    messagesOf(sessionID).findLast((m): m is AssistantMessage => m.role === "assistant")

  const toolPartsOf = (sessionID: string): ToolPart[] => {
    const msgs = messagesOf(sessionID)
    return msgs.flatMap((msg) => (sync.data.part[msg.id] ?? []).filter((p): p is ToolPart => p.type === "tool"))
  }

  const workerStatus = (sessionID: string): "running" | "completed" | "failed" => {
    const status = childStatus(sessionID)
    if (status !== "idle") return "running"
    const parts = toolPartsOf(sessionID)
    const lastError = parts.findLast((p) => p.state.status === "error")
    if (lastError) return "failed"
    const lastMsg = lastAssistant(sessionID)
    if (lastMsg && lastMsg.tokens.output === 0) return "failed"
    return "completed"
  }

  const lastToolError = (sessionID: string): string | undefined => {
    const parts = toolPartsOf(sessionID)
    const err = parts.findLast((p) => p.state.status === "error")
    return err && err.state.status === "error" ? err.state.error : undefined
  }

  const workerPrompt = (sessionID: string): string => {
    const msgs = messagesOf(sessionID)
    const user = msgs.find((m): m is UserMessage => m.role === "user")
    if (!user) return ""
    const parts = sync.data.part[user.id] ?? []
    const text = parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("")
    return text.length > PROMPT_MAX ? text.slice(0, PROMPT_MAX - 1) + "…" : text
  }

  const workerCost = (sessionID: string): number => sync.session.get(sessionID)?.cost ?? 0

  const workerTokens = (sessionID: string): number => {
    const last = lastAssistant(sessionID)
    return last ? last.tokens.output : 0
  }

  const workerEscalation = (sessionID: string): { escalation?: "retry"; next?: number; attempt?: number } => {
    const status = sync.data.session_status[sessionID]
    if (status && status.type === "retry") return { escalation: "retry", next: status.next, attempt: status.attempt }
    return {}
  }

  const workers = createMemo<WorkerInfo[]>(() =>
    children().map((session) => {
      const esc = workerEscalation(session.id)
      return {
        session,
        status: workerStatus(session.id),
        error: lastToolError(session.id),
        prompt: workerPrompt(session.id),
        cost: workerCost(session.id),
        tokens: workerTokens(session.id),
        batch: 0,
        ...esc,
      }
    }),
  )

  const batches = createMemo<Batch[]>(() => {
    const list = workers()
    if (list.length === 0) return [] as Batch[]
    const sorted = [...list].toSorted((a, b) => a.session.time.created - b.session.time.created)
    const groups: WorkerInfo[][] = []
    let prevTime = -Infinity
    for (const w of sorted) {
      if (w.session.time.created - prevTime > BATCH_GAP_MS || groups.length === 0) {
        groups.push([w])
      } else {
        groups[groups.length - 1].push(w)
      }
      prevTime = w.session.time.created
    }
    return groups.map((group, index) => {
      const ids = group.map((w) => w.session.id)
      const anyRunning = group.some((w) => w.status === "running")
      const anyFailed = group.some((w) => w.status === "failed")
      return {
        index,
        workerIDs: ids,
        status: anyRunning ? "running" : anyFailed ? "failed" : "done",
      }
    })
  })

  const workersWithBatch = createMemo<WorkerInfo[]>(() => {
    const batched = batches()
    const byID = new Map<string, number>()
    for (const b of batched) for (const id of b.workerIDs) byID.set(id, b.index)
    return workers().map((w) => ({ ...w, batch: byID.get(w.session.id) ?? 0 }))
  })

  const inFlight = createMemo(() => workersWithBatch().filter((w) => w.status === "running"))
  const completed = createMemo(() => workersWithBatch().filter((w) => w.status === "completed"))
  const failed = createMemo(() => workersWithBatch().filter((w) => w.status === "failed"))

  const ratio = createMemo(() => ({ done: completed().length, total: workers().length }))
  const progressRatio = createMemo(() => {
    const r = ratio()
    return { done: r.done, total: r.total }
  })

  const parentStatus = createMemo(() => {
    const id = parentSessionID()
    if (!id) return "idle" as const
    return sync.data.session_status[id]?.type ?? ("idle" as const)
  })

  const active = createMemo(() => workers().length > 0 || parentStatus() !== "idle")
  const allIdle = createMemo(() => workers().length > 0 && inFlight().length === 0 && parentStatus() === "idle")

  const state = createMemo(() => workflowStore[parentSessionID() ?? ""])

  const failedSorted = createMemo(() => {
    const list = workersWithBatch()
    const ff = state()?.failedFirst ?? false
    if (!ff) return list
    return [...list].toSorted((a, b) => {
      const af = a.status === "failed" ? 0 : 1
      const bf = b.status === "failed" ? 0 : 1
      return af - bf
    })
  })

  const orchestratorThinking = createMemo(() => {
    if (workers().length > 0) return undefined
    const id = parentSessionID()
    if (!id) return undefined
    if (parentStatus() === "idle") return undefined
    const msgs = messagesOf(id)
    const last = msgs.findLast((m): m is AssistantMessage => m.role === "assistant")
    if (!last) return undefined
    const parts = sync.data.part[last.id] ?? []
    const text = parts.filter((p): p is TextPart => p.type === "text").map((p) => p.text).join("")
    if (!text) return undefined
    return text
  })

  const DIFF_TOOLS = new Set(["edit", "write", "apply_patch"])

  const aggregateDiff = createMemo(() => {
    const id = parentSessionID()
    if (!id) return { added: 0, removed: 0, files: 0 }
    const msgs = messagesOf(id)
    let added = 0
    let removed = 0
    const files = new Set<string>()
    for (const msg of msgs) {
      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type !== "tool") continue
        const tool = part as ToolPart
        if (!DIFF_TOOLS.has(tool.tool)) continue
        const state = tool.state
        if (state.status === "pending") continue
        const metadata = state.metadata ?? {}
        const filediff = metadata.filediff as { file?: string; additions?: number; deletions?: number } | undefined
        if (filediff) {
          added += filediff.additions ?? 0
          removed += filediff.deletions ?? 0
          if (filediff.file) files.add(filediff.file)
        }
      }
    }
    return { added, removed, files: files.size }
  })

  const latestTodos = createMemo(() => {
    const id = parentSessionID()
    if (!id) return [] as Todo[]
    return sync.data.todo[id] ?? []
  })

  createEffect(() => {
    const id = parentSessionID()
    if (!id) return
    ensureEntry(id)
  })

  createEffect(() => {
    const id = parentSessionID()
    if (!id) return
    ensureEntry(id)
    startActiveHistorySampling(id, inFlight)
  })

  onCleanup(() => {
    const id = parentSessionID()
    if (id) {
      const stop = activeHistorySamplers.get(id)
      if (stop) stop()
      pruneIfEmpty(id)
    }
  })

  return {
    workers: workersWithBatch,
    inFlight,
    completed,
    failed,
    ratio,
    progressRatio,
    active,
    allIdle,
    state,
    batches,
    failedSorted,
    orchestratorThinking,
    aggregateDiff,
    latestTodos,
  }
}

export function currentToolOf(sync: ReturnType<typeof useSync>, sessionID: string): CurrentTool {
  const msgs = sync.data.message[sessionID] ?? []
  const lastAssistant = msgs.findLast((m): m is AssistantMessage => m.role === "assistant")
  if (!lastAssistant) return null
  const parts = sync.data.part[lastAssistant.id] ?? []
  const tools = parts.filter((p): p is ToolPart => p.type === "tool")
  const current = tools.findLast((x) => x.state.status === "running" || x.state.status === "completed")
  if (!current) return null
  const state = current.state
  const title = state.status === "running" || state.status === "completed" ? state.title : undefined
  return { tool: current.tool, title }
}

export * as WorkflowUse from "./use-workflow"