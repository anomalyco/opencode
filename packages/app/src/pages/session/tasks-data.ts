import { createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "./session-layout"
import type { Part } from "@opencode-ai/sdk/v2/client"

type TaskToolState = Extract<Part, { type: "tool" }>["state"]

export type TasksItemState = "running" | "needs-input" | "completed" | "failed"

export interface TasksItem {
  /** Stable key: child session id for subagents, callID for shell tools. */
  key: string
  kind: "agent" | "shell"
  headline: string
  agent?: string
  state: TasksItemState
  startTime: number
  endTime?: number
  /** Child session id — the official join key (task.ts metadata.sessionId). */
  childId?: string
  /** Parent session that spawned the work. */
  sessionId: string
  /** Nested subagent count ((+N), Claude panel parity). */
  nested?: number
  /** Live aggregates scanned from the child session transcript. */
  stats?: TaskStats
}

export interface TaskStats {
  model?: string
  agent?: string
  toolCalls: number
  fails: number
  tokensIn: number
  tokensOut: number
  cost: number
}

/**
 * Derives the background-work list for the current session from the already
 * synced reactive stores — sessions (incl. children via parentID),
 * message parts, session status and pending permissions.
 *
 * No fetching, no polling, no event wiring: every input below is a synced
 * store, so the panel updates automatically with the transcript.
 */

const toolTitle = (state: TaskToolState): string | undefined => {
  if (state.status === "completed" || state.status === "running") return state.title
  return undefined
}

const toolStart = (state: TaskToolState): number | undefined => {
  if (state.status === "pending") return undefined
  return state.time.start
}

const toolEnd = (state: TaskToolState): number | undefined => {
  if (state.status === "completed" || state.status === "error") return state.time.end
  return undefined
}

const toolMetadata = (part: Extract<Part, { type: "tool" }>): Record<string, unknown> => {
  if (part.state.status === "pending") return (part.metadata ?? {}) as Record<string, unknown>
  return (part.metadata ?? part.state.metadata ?? {}) as Record<string, unknown>
}

export function createTasksData() {
  const sync = useSync()
  const { params } = useSessionLayout()
  const sessionID = createMemo(() => params.id)

  const children = createMemo(() => {
    const sid = sessionID()
    if (!sid) return []
    return (sync().data.session ?? []).filter((s) => s.parentID === sid)
  })

  const taskParts = createMemo(() => {
    const sid = sessionID()
    if (!sid) return []
    const messages = sync().data.session_message ?? {}
    const partsByMessage = sync().data.part ?? {}
    const out: { part: Extract<Part, { type: "tool" }>; messageID: string }[] = []
    for (const msg of messages[sid] ?? []) {
      for (const part of partsByMessage[msg.id] ?? []) {
        if (part.type !== "tool") continue
        if (part.tool !== "task" && part.tool !== "bash" && part.tool !== "shell") continue
        out.push({ part, messageID: msg.id })
      }
    }
    return out
  })

  const grandchildren = createMemo(() => {
    const map = new Map<string, number>()
    for (const s of sync().data.session ?? []) {
      if (!s.parentID) continue
      map.set(s.parentID, (map.get(s.parentID) ?? 0) + 1)
    }
    return map
  })

  /* Pending permissions indexed both ways: PermissionRequest carries the
     owning sessionID and, when raised by a tool call, tool.callID. */
  const pendingPermissions = createMemo(() => {
    const sessions = new Set<string>()
    const calls = new Set<string>()
    for (const [sid, reqs] of Object.entries(sync().data.permission ?? {})) {
      if (!reqs || reqs.length === 0) continue
      sessions.add(sid)
      for (const req of reqs) {
        if (req.tool) calls.add(req.tool.callID)
      }
    }
    return { sessions, calls }
  })

  const items = createMemo(() => {
    const sid = sessionID()
    if (!sid) return { running: [] as TasksItem[], finished: [] as TasksItem[] }
    const data = sync().data
    const perms = pendingPermissions()
    const nested = grandchildren()
    const running: TasksItem[] = []
    const finished: TasksItem[] = []
    const seen = new Set<string>()

    const needsInput = (childId: string | undefined, callID: string): boolean =>
      (childId !== undefined && perms.sessions.has(childId)) || perms.calls.has(callID)

    const stateOf = (
      childId: string | undefined,
      callID: string,
      toolState: string,
    ): TasksItemState => {
      if (needsInput(childId, callID)) return "needs-input"
      if (toolState === "error") return "failed"
      if (toolState === "completed") return "completed"
      return "running"
    }

    for (const { part } of taskParts()) {
      const st = part.state.status
      if (part.tool === "task") {
        const meta = toolMetadata(part)
        const childId = typeof meta.sessionId === "string" ? meta.sessionId : undefined
        const key = childId ?? part.callID
        if (seen.has(key)) continue
        seen.add(key)
        const input = (part.state.input ?? {}) as Record<string, unknown>
        const headline =
          toolTitle(part.state) ??
          (typeof input.description === "string" && input.description.length > 0
            ? input.description
            : "Subagent")
        const agent =
          typeof input.subagent_type === "string" && input.subagent_type.length > 0
            ? input.subagent_type
            : undefined
        // task.ts records the resolved model in the tool call metadata —
        // authoritative even before the child transcript syncs any message.
        const toolModel = meta.model as { modelID?: string; providerID?: string } | undefined
        const stats = childId ? childStats(data, childId) : undefined
        if (stats && !stats.model && toolModel?.modelID && toolModel?.providerID) {
          const short = toolModel.modelID.replace(/^(anthropic|openai|google|opencode)-/i, "")
          stats.model = `${toolModel.providerID}/${short}`
        }
        const item: TasksItem = {
          key,
          kind: "agent",
          headline,
          agent,
          state: stateOf(childId, part.callID, st),
          startTime: toolStart(part.state) ?? Date.now(),
          endTime:
            st === "completed" || st === "error" ? (toolEnd(part.state) ?? Date.now()) : undefined,
          childId,
          sessionId: sid,
          nested: childId ? nested.get(childId) || undefined : undefined,
          stats,
        }
        // A live child session outranks a stale completed part (resume via task_id reuses the id).
        if (childId && (st === "completed" || st === "error") && data.session_working(childId)) {
          item.state = perms.sessions.has(childId) ? "needs-input" : "running"
          item.endTime = undefined
        }
        if (item.state === "running" || item.state === "needs-input") running.push(item)
        else finished.push(item)
      } else {
        // Foreground shell tools surface as Shell cards while running.
        if (st !== "running" && st !== "pending") continue
        if (seen.has(part.callID)) continue
        seen.add(part.callID)
        running.push({
          key: part.callID,
          kind: "shell",
          headline: toolTitle(part.state) ?? part.tool,
          state: perms.calls.has(part.callID) ? "needs-input" : "running",
          startTime: toolStart(part.state) ?? Date.now(),
          sessionId: sid,
        })
      }
    }

    for (const child of children()) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      const working = data.session_working(child.id)
      const live = perms.sessions.has(child.id) ? "needs-input" : working ? "running" : "completed"
      const item: TasksItem = {
        key: child.id,
        kind: "agent",
        headline: child.title || "Subagent",
        state: live,
        startTime: child.time.created ?? Date.now(),
        childId: child.id,
        sessionId: sid,
        nested: nested.get(child.id) || undefined,
        stats: childStats(data, child.id),
      }
      if (live === "running" || live === "needs-input") running.push(item)
      else finished.push(item)
    }

    running.sort((a, b) => b.startTime - a.startTime)
    finished.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
    return { running: running, finished: finished.slice(0, 12) }
  })

  const liveCount = createMemo(() => items().running.length)

  return { items, liveCount }
}

function shortModel(providerID: string, modelID: string): string {
  const short = modelID.replace(/^(anthropic|openai|google|opencode)-/i, "")
  return `${providerID}/${short}`
}

/** Scans a child session transcript into live aggregates. Pure derivation
    over the synced message/part stores — no fetching. */
export function childStats(
  data: {
    session_message: Record<string, { id: string }[] | undefined>
    part: Record<string, Part[] | undefined>
  },
  childId: string,
): TaskStats {
  const stats: TaskStats = { toolCalls: 0, fails: 0, tokensIn: 0, tokensOut: 0, cost: 0 }
  const messages = data.session_message[childId] ?? []
  for (const msg of messages) {
    const full = msg as unknown as {
      role?: string
      modelID?: string
      providerID?: string
      model?: string
      provider?: string
      modelId?: string
      providerId?: string
      model_id?: string
      provider_id?: string
      agent?: string
      tokens?: { input?: number; output?: number }
      cost?: number
    }
    if (full.role === "assistant") {
      // Model fields vary across sync shapes — try every known spelling.
      const modelID = full.modelID ?? full.modelId ?? full.model_id ?? full.model
      const providerID = full.providerID ?? full.providerId ?? full.provider_id ?? full.provider
      if (modelID && providerID) stats.model = shortModel(providerID, modelID)
      if (full.agent) stats.agent = full.agent
      stats.tokensIn += full.tokens?.input ?? 0
      stats.tokensOut += full.tokens?.output ?? 0
      stats.cost += full.cost ?? 0
    }
    for (const part of data.part[msg.id] ?? []) {
      if (part.type !== "tool") continue
      stats.toolCalls += 1
      if (part.state.status === "error") stats.fails += 1
    }
  }
  return stats
}
