import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { useServerSync } from "@/context/server-sync"
import { bucketize, dedupeForks, rollingOut1m, sumSparks, WINDOW_SECS, type WindowKey, type TokenTick } from "./lib/bucket"
import { ttftSeconds } from "./lib/latency"
import { mapStage } from "./lib/stage"
import { cacheShare, isRateWorthy } from "./lib/format"
import { loadFilter, loadProject, loadWindow, saveFilter, saveProject, saveWindow } from "./lib/persist"
import type { FleetData, FleetFilter, FleetFilterKind, FleetKind, FleetRowData } from "./fleetTypes"

const MAX_ROWS = 100

const KIND_RANK: Record<FleetKind, number> = { working: 0, permission: 1, error: 2, unseen: 3, idle: 4 }

const seconds = (ms: number | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? Math.floor(ms / 1000) : 0)

export function useFleet(): FleetData {
  const layout = useLayout()
  const sync = useServerSync()
  const permission = usePermission()

  const [window, setWindowSignal] = createSignal<WindowKey>(loadWindow())
  const FILTER_KINDS: FleetFilterKind[] = ["all", "working", "input", "idle", "error"]
  const storedKind = loadFilter() as FleetFilterKind
  const [filter, setFilter] = createSignal<FleetFilter>({
    kind: FILTER_KINDS.includes(storedKind) ? storedKind : "all",
    project: loadProject(),
  })
  const [now, setNow] = createSignal(Math.floor(Date.now() / 1000))

  const directories = createMemo(() =>
    layout.projects
      .list()
      .flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])]),
  )

  createEffect(() => {
    for (const directory of directories()) {
      sync().child(directory, { bootstrap: true })
      void sync().project.loadSessions(directory).catch(() => undefined)
    }
  })

  const sessions = createMemo(() => {
    const byID = new Map<string, Session>()
    for (const directory of directories()) {
      const [store] = sync().child(directory, { bootstrap: false })
      for (const item of store.session) {
        if (item.time?.archived !== undefined) continue
        byID.set(item.id, item)
      }
    }
    return [...byID.values()]
  })

  const anyLive = createMemo(() => sessions().some((item) => sync().session.data.session_working(item.id)))

  createEffect(() => {
    const period = anyLive() ? 500 : 20000
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

  const latFor = (sessionID: string, directory: string): number | null => {
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
    const perms = (sync().session.data.permission[sessionID] ?? []).filter(
      (request) => !permission.autoResponds(request, directory),
    )
    return ttftSeconds({
      promptAt: userAt,
      firstPartAt,
      permissionWindows: perms.length > 0 ? [{ askedAt: userAt, repliedAt: null }] : [],
    })
  }

  const updatedAt = createMemo(() => {
    const map = new Map<string, number>()
    for (const item of sessions()) map.set(item.id, item.time.updated ?? item.time.created ?? 0)
    return map
  })

  const rows = createMemo<FleetRowData[]>(() => {
    const at = now()
    const filterValue = filter()
    const result: FleetRowData[] = []
    for (const item of sessions()) {
      const busy = sync().session.data.session_working(item.id)
      const perms = (sync().session.data.permission[item.id] ?? []).filter(
        (request) => !permission.autoResponds(request, item.directory),
      )
      const questions = sync().session.data.question[item.id] ?? []
      const pending = perms.length > 0 || questions.length > 0
      const messages = sync().session.data.message[item.id] ?? []
      let lastAgent = ""
      let error = false
      for (const message of messages) {
        if (message.role !== "assistant") continue
        lastAgent = message.agent
        if (message.error) error = true
      }
      const retry = sync().session.data.session_status[item.id]?.type === "retry"
      const todos = sync().session.data.todo[item.id] ?? []
      const diff = sync().session.data.session_diff[item.id] ?? []
      const todosActive = todos.some((todo) => todo.status === "in_progress")

      const kind: FleetKind = pending ? "permission" : error || retry ? "error" : busy ? "working" : "idle"
      if (filterValue.kind !== "all" && !matchesFilter(kind, filterValue.kind)) continue
      if (filterValue.project && item.directory !== filterValue.project) continue

      const ticks = ticksFor(item.id)
      const out1m = rollingOut1m(ticks, at)
      const tokens = item.tokens

      result.push({
        sessionID: item.id,
        directory: item.directory,
        title: item.title,
        agent: item.agent ?? lastAgent,
        model: item.model ? `${item.model.providerID}/${item.model.id}` : "",
        provider: item.model?.providerID ?? "",
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
        lat: latFor(item.id, item.directory),
        spark: bucketize(ticks, at, WINDOW_SECS[window()]),
        live: busy,
        kind,
        sandbox: false,
        forkChild: !!item.parentID,
      })
    }
    const times = updatedAt()
    result.sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        (times.get(b.sessionID) ?? 0) - (times.get(a.sessionID) ?? 0) ||
        (a.sessionID < b.sessionID ? -1 : 1),
    )
    return result.slice(0, MAX_ROWS)
  })

  const totalSpark = createMemo(() => sumSparks(...rows().map((row) => row.spark)))
  const out1mAll = createMemo(() => {
    const at = now()
    let total = 0
    for (const item of sessions()) total += rollingOut1m(ticksFor(item.id), at)
    return total
  })

  return {
    rows,
    totalSpark,
    out1mAll: () => out1mAll(),
    anyLive,
    window,
    setWindow: (value) => {
      setWindowSignal(value)
      saveWindow(value)
    },
    filter,
    setFilterKind: (kind) => {
      setFilter((current) => {
        saveFilter(kind)
        return { ...current, kind }
      })
    },
    setProject: (project) => {
      setFilter((current) => {
        saveProject(project)
        return { ...current, project }
      })
    },
  }
}

function matchesFilter(kind: FleetKind, filter: FleetFilterKind): boolean {
  if (filter === "working") return kind === "working"
  if (filter === "input") return kind === "permission"
  if (filter === "error") return kind === "error"
  if (filter === "idle") return kind === "idle" || kind === "unseen"
  return true
}
