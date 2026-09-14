import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { bucketize, dedupeForks, rollingOut1m, sumSparks, WINDOW_SECS, type WindowKey, type TokenTick } from "./lib/bucket"
import { costBreakdown, type CostSample } from "./lib/cost"
import { ttftSeconds } from "./lib/latency"
import { mapStage } from "./lib/stage"
import { cacheShare, isRateWorthy } from "./lib/format"
import { buildTree } from "./lib/tree"
import { loadFilter, loadProject, loadWindow, saveFilter, saveProject, saveWindow } from "./lib/persist"
import type { AttentionItem, FleetData, FleetFilter, FleetFilterKind, FleetKind, FleetRowData } from "./fleetTypes"

const MAX_ROWS = 200
// Sessions whose messages are pulled for sparks, burn and latency; bounded to keep the page cheap.
const MESSAGE_SYNC_CAP = 40

const KIND_RANK: Record<FleetKind, number> = { working: 0, permission: 1, error: 2, unseen: 3, idle: 4 }

const seconds = (ms: number | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? Math.floor(ms / 1000) : 0)

export function useFleet(): FleetData {
  const layout = useLayout()
  const sync = useServerSync()
  const serverSDK = useServerSDK()
  const permission = usePermission()

  const [window, setWindowSignal] = createSignal<WindowKey>(loadWindow())
  const FILTER_KINDS: FleetFilterKind[] = ["all", "working", "input", "idle", "error"]
  const storedKind = loadFilter() as FleetFilterKind
  const [filter, setFilter] = createSignal<FleetFilter>({
    kind: FILTER_KINDS.includes(storedKind) ? storedKind : "all",
    project: loadProject(),
  })
  const [collapsed, setCollapsed] = createSignal(new Set<string>())
  const [now, setNow] = createSignal(Math.floor(Date.now() / 1000))
  const [fetchedChildren, setFetchedChildren] = createSignal(new Map<string, Session>())

  const directories = createMemo(() =>
    layout.projects.list().flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])]),
  )

  createEffect(() => {
    for (const directory of directories()) {
      sync().child(directory, { bootstrap: true })
      void sync().project.loadSessions(directory).catch(() => undefined)
    }
  })

  const storeSessions = createMemo(() => {
    const list: Session[] = []
    for (const directory of directories()) {
      const [store] = sync().child(directory, { bootstrap: false })
      for (const item of store.session) if (item.time?.archived === undefined) list.push(item)
    }
    return list
  })

  const sessions = createMemo(() => {
    const byID = new Map<string, Session>()
    for (const child of fetchedChildren().values()) byID.set(child.id, child)
    // Live store copies win over the one-off fetch.
    for (const item of storeSessions()) byID.set(item.id, item)
    return [...byID.values()]
  })

  // Store only holds root sessions plus children created while connected; pull historical subagents once per session.
  const childrenRequested = new Set<string>()
  createEffect(() => {
    for (const item of sessions()) {
      if (childrenRequested.has(item.id)) continue
      childrenRequested.add(item.id)
      void serverSDK()
        .createClient({ directory: item.directory, throwOnError: true })
        .session.children({ sessionID: item.id })
        .then((result) => {
          const found = (result.data ?? []).filter((child) => !child.time?.archived)
          if (found.length === 0) return
          setFetchedChildren((current) => {
            const next = new Map(current)
            for (const child of found) next.set(child.id, child)
            return next
          })
        })
        .catch(() => undefined)
    }
  })

  const synced = new Set<string>()
  createEffect(() => {
    const cutoff = (now() - WINDOW_SECS[window()]) * 1000
    const recent = sessions()
      .filter((item) => sync().session.data.session_working(item.id) || (item.time.updated ?? 0) >= cutoff)
      .sort((a, b) => (b.time.updated ?? 0) - (a.time.updated ?? 0))
      .slice(0, MESSAGE_SYNC_CAP)
    for (const item of recent) {
      if (synced.has(item.id)) continue
      synced.add(item.id)
      void sync().session.sync(item.id)
    }
  })

  const anyLive = createMemo(() => sessions().some((item) => sync().session.data.session_working(item.id)))

  createEffect(() => {
    const period = anyLive() ? 1000 : 20000
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), period)
    onCleanup(() => clearInterval(timer))
  })

  const ticksFor = (sessionID: string): TokenTick[] => {
    const messages = sync().session.data.message[sessionID] ?? []
    let cutoff = 0
    for (const message of messages) {
      if (message.role === "assistant" && message.summary) cutoff = Math.max(cutoff, seconds(message.time.created))
    }
    const ticks: TokenTick[] = []
    for (const message of messages) {
      if (message.role !== "assistant") continue
      const out = message.tokens?.output ?? 0
      const at = seconds(message.time.completed ?? message.time.created)
      if (out <= 0 || at <= 0 || at <= cutoff) continue
      ticks.push({ t: at, out, sessionID, turnID: message.parentID })
    }
    return dedupeForks(ticks)
  }

  const pendingPermissions = (item: Session): PermissionRequest[] =>
    (sync().session.data.permission[item.id] ?? []).filter((request) => !permission.autoResponds(request, item.directory))
  const pendingQuestions = (item: Session): QuestionRequest[] => sync().session.data.question[item.id] ?? []

  const latFor = (sessionID: string, pending: boolean): number | null => {
    const messages = sync().session.data.message[sessionID] ?? []
    let userAt = 0
    for (const message of messages) {
      if (message.role !== "user") continue
      userAt = seconds(message.time.created)
    }
    if (userAt <= 0) return null
    const parts = messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => sync().session.data.part[message.id] ?? [])
    let firstPartAt: number | null = null
    for (const part of parts) {
      if (!("time" in part)) continue
      const time = part.time as { start?: number }
      const start = seconds(time?.start)
      if (start > userAt && (firstPartAt === null || start < firstPartAt)) firstPartAt = start
    }
    return ttftSeconds({
      promptAt: userAt,
      firstPartAt,
      permissionWindows: pending ? [{ askedAt: userAt, repliedAt: null }] : [],
    })
  }

  const allRows = createMemo<FleetRowData[]>(() => {
    const at = now()
    const result: FleetRowData[] = []
    for (const item of sessions()) {
      const busy = sync().session.data.session_working(item.id)
      const perms = pendingPermissions(item)
      const questions = pendingQuestions(item)
      const pending = perms.length > 0 || questions.length > 0
      const messages = sync().session.data.message[item.id] ?? []
      let lastAgent = ""
      let lastModel = ""
      let lastProvider = ""
      let error = false
      for (const message of messages) {
        if (message.role !== "assistant") continue
        lastAgent = message.agent
        lastModel = message.modelID
        lastProvider = message.providerID
        error = !!message.error
      }
      const retry = sync().session.data.session_status[item.id]?.type === "retry"
      const todos = sync().session.data.todo[item.id] ?? []
      const diff = sync().session.data.session_diff[item.id] ?? []
      const todosActive = todos.some((todo) => todo.status === "in_progress")
      const kind: FleetKind = pending ? "permission" : error || retry ? "error" : busy ? "working" : "idle"
      const ticks = ticksFor(item.id)
      const out1m = rollingOut1m(ticks, at)
      const tokens = item.tokens
      const provider = item.model?.providerID ?? lastProvider

      result.push({
        sessionID: item.id,
        directory: item.directory,
        title: item.title,
        agent: item.agent ?? lastAgent,
        model: item.model ? `${item.model.providerID}/${item.model.id}` : lastModel ? `${lastProvider}/${lastModel}` : "",
        provider,
        role: item.parentID ? "subagent" : "orchestrator",
        parentID: item.parentID ?? null,
        stage: mapStage({
          permissionPending: pending,
          busy,
          error,
          retry,
          questionPending: questions.length > 0,
          diffNonEmpty: diff.length > 0,
          idle: !busy,
          todosProposed: todos.length > 0 && !todosActive,
          todosActive,
        }),
        tin: tokens?.input ?? 0,
        tout: tokens?.output ?? 0,
        tps: isRateWorthy(out1m) ? out1m / 60 : 0,
        cachePct: tokens ? Math.floor(cacheShare(tokens) * 100) : 0,
        cost: item.cost ?? 0,
        priced: (item.cost ?? 0) > 0,
        lat: latFor(item.id, pending),
        spark: bucketize(ticks, at, WINDOW_SECS[window()]),
        live: busy,
        kind,
        sandbox: false,
        forkChild: !!item.parentID,
        updated: item.time.updated ?? item.time.created ?? 0,
      })
    }
    result.sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.updated - a.updated || (a.sessionID < b.sessionID ? -1 : 1),
    )
    return result.slice(0, MAX_ROWS)
  })

  const nodes = createMemo(() => {
    const value = filter()
    return buildTree(allRows(), {
      collapsed: collapsed(),
      match: (row) =>
        (value.kind === "all" || matchesFilter(row.kind, value.kind)) &&
        (!value.project || row.directory === value.project),
    })
  })

  const attention = createMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    for (const item of sessions()) {
      for (const request of pendingPermissions(item)) {
        items.push({ kind: "permission", sessionID: item.id, directory: item.directory, title: item.title, request })
      }
      for (const request of pendingQuestions(item)) {
        items.push({ kind: "question", sessionID: item.id, directory: item.directory, title: item.title, request })
      }
    }
    return items
  })

  const cost = createMemo(() => {
    const samples: CostSample[] = []
    for (const item of sessions()) {
      for (const message of sync().session.data.message[item.id] ?? []) {
        if (message.role !== "assistant") continue
        const t = seconds(message.time.completed ?? message.time.created)
        const tk = message.tokens
        samples.push({
          t,
          cost: message.cost,
          tokens: (tk?.input ?? 0) + (tk?.output ?? 0) + (tk?.reasoning ?? 0),
          provider: message.providerID,
          model: message.modelID,
        })
      }
    }
    return costBreakdown(samples, now(), WINDOW_SECS[window()])
  })

  const totalCost = createMemo(() => sessions().reduce((sum, item) => sum + (item.cost ?? 0), 0))
  const totalSpark = createMemo(() => sumSparks(...allRows().map((row) => row.spark)))
  const out1mAll = createMemo(() => {
    const at = now()
    let total = 0
    for (const item of sessions()) total += rollingOut1m(ticksFor(item.id), at)
    return total
  })

  return {
    rows: allRows,
    nodes,
    attention,
    cost,
    totalCost,
    totalSpark,
    out1mAll: () => out1mAll(),
    anyLive,
    projects: directories,
    window,
    setWindow: (value) => {
      setWindowSignal(value)
      saveWindow(value)
    },
    filter,
    setFilterKind: (kind) => {
      saveFilter(kind)
      setFilter((current) => ({ ...current, kind }))
    },
    setProject: (project) => {
      saveProject(project)
      setFilter((current) => ({ ...current, project }))
    },
    toggleCollapsed: (sessionID) =>
      setCollapsed((current) => {
        const next = new Set(current)
        if (!next.delete(sessionID)) next.add(sessionID)
        return next
      }),
  }
}

function matchesFilter(kind: FleetKind, filter: FleetFilterKind): boolean {
  if (filter === "working") return kind === "working"
  if (filter === "input") return kind === "permission"
  if (filter === "error") return kind === "error"
  if (filter === "idle") return kind === "idle" || kind === "unseen"
  return true
}
