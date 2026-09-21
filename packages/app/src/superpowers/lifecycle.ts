import type { OpenCodeEvent, RpcCallOptions, RpcClient } from "@opencode/client/promise"
import { ExecutionRpc, type RunSnapshot, type RunSummary } from "@bearmanser/opencode-superpowers-execution/contract"
import { createRoot, createSignal } from "solid-js"
import { ServerConnection } from "@/runtime/server/registry"
import {
  EXECUTION_RECONCILE_INTERVAL,
  createSessionExecution,
  type ExecutionEventSource,
  type SessionExecution,
} from "./bridge-client"
import { runFixture, taskFixture } from "./fixtures"
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  cachedLayout,
  graphDimensionKey,
  layoutTaskGraph,
  resetLayoutCache,
  type GraphMeasurer,
} from "./graph-layout"
import type { ExecutionScope } from "./identity"
import { createExecutionModel } from "./model"
import { createNativeExecutionAdapter, type NativeBoundary, type NativeSessionInfo } from "./native-adapter"
import { createNativeExecutionOwner, type NativeExecutionOwner } from "./native-execution"

const RPC_EVENT_TYPE = "rpc.superpowers.execution.v1.changed"
const OWNER_DIRECTORY = "/root/git/demo"
const HARNESS_SERVER_KEY = ServerConnection.Key.make("wsl:Ubuntu")

export type LifecycleView = {
  readonly model: SessionExecution["model"]
  snapshot(): RunSnapshot | undefined
  reconcile(): Promise<void>
  attach(runID: string): void
  dispose(): void
}

export type LifecycleHarness = {
  open(input: {
    rootSessionID: string
    runID?: string
    descendants?: number
    visible?: boolean
    longTitles?: boolean
  }): LifecycleView
  listenerCount(): number
  intervalCount(): number
  cacheSize(): number
  maxConcurrentDetails(): number
  maxSyncSpanMs(): number
  runCallCount(): number
  closedDashboardFullRunPolls(rounds?: number): Promise<number>
  setVisible(visible: boolean): void
  setConnected(connected: boolean): void
  emitChanged(rootSessionID: string, runID: string, revision: number): void
  advance(ms: number): void
  flush(rounds?: number): Promise<void>
}

export type GraphBudgetMetrics = {
  graphLayout500Ms: number
  graphLayout500P95Ms: number
  graphLayoutsForTokenOnlyUpdates: number
  graphLayoutsForLongTitles: number
  retainedNodes: number
  statusUpdateP95Ms: number
}

export function percentile(values: number[], target: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((target / 100) * sorted.length) - 1))
  return sorted[index]!
}

export function lifecycleHarness(): LifecycleHarness {
  const events = trackedEvents()
  const clock = fakeClock()
  const [scope, setScope] = createSignal<ExecutionScope | undefined>()
  const [connected, setConnected] = createSignal(true)
  const [visible, setVisibleSignal] = createSignal(false)
  const runs = new Map<string, RunSnapshot>()
  const runCalls: Array<{ rootSessionID: string; runID: string; visible: boolean }> = []
  const syncSpans: number[] = []
  const detailState = { current: 0, max: 0 }
  let activeRoot: string | undefined
  let activeRun: string | undefined
  let descendantCount = 0
  let longTitles = false
  let liveExecution: SessionExecution | undefined

  const runKeyOf = (rootSessionID: string, runID: string) => `${rootSessionID}\u0000${runID}`

  const summaries = (): RunSummary[] => {
    if (!activeRoot || !activeRun) return []
    const snapshot = runs.get(runKeyOf(activeRoot, activeRun))
    return snapshot ? [summaryOf(snapshot)] : []
  }

  const api = {
    capabilities: async () => ({ schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }),
    getSummaries: async () => ({ items: summaries() }),
    getRun: async (input: { rootSessionID: string; runID: string }) => {
      runCalls.push({ rootSessionID: input.rootSessionID, runID: input.runID, visible: visible() })
      const snapshot = runs.get(runKeyOf(input.rootSessionID, input.runID))
      if (!snapshot) throw new Error(`unexpected getRun for ${input.runID}`)
      return snapshot
    },
    listRuns: async () => ({ items: [] }),
    events: {
      subscribe: () => {
        throw new Error("events.subscribe is not used by the bridge")
      },
      on: () => () => {},
    },
  } as unknown as RpcClient<typeof ExecutionRpc, RpcCallOptions>

  const boundary: NativeBoundary = {
    detail: async ({ sessionID }) => {
      detailState.current += 1
      detailState.max = Math.max(detailState.max, detailState.current)
      await new Promise((resolve) => setTimeout(resolve, 1))
      detailState.current -= 1
      return { info: nativeInfo(sessionID, activeRoot, longTitles), needsInput: false }
    },
    children: async ({ sessionID }) => {
      if (sessionID !== activeRoot || descendantCount === 0) return { data: [] }
      return {
        data: Array.from({ length: descendantCount }, (_, index) =>
          nativeInfo(`child-${String(index).padStart(3, "0")}`, activeRoot, longTitles),
        ),
      }
    },
    active: async () => ({}),
  }

  function open(input: {
    rootSessionID: string
    runID?: string
    descendants?: number
    visible?: boolean
    longTitles?: boolean
  }): LifecycleView {
    const runID = input.runID ?? "run"
    activeRoot = input.rootSessionID
    activeRun = runID
    descendantCount = input.descendants ?? 0
    longTitles = input.longTitles ?? false
    if (input.visible !== undefined) setVisibleSignal(input.visible)
    runs.set(runKeyOf(input.rootSessionID, runID), runSnapshot(input.rootSessionID, runID))
    setScope({ serverKey: HARNESS_SERVER_KEY, ownerDirectory: OWNER_DIRECTORY, rootSessionID: input.rootSessionID })

    const constructed = performance.now()
    let disposeRoot!: () => void
    let execution!: SessionExecution
    let native!: NativeExecutionOwner
    createRoot((dispose) => {
      disposeRoot = dispose
      execution = createSessionExecution({
        scope,
        api: () => api,
        events: events.source,
        connection: connected,
        visible,
        clock: clock.clock,
      })
      native = createNativeExecutionOwner({
        scope: () =>
          activeRoot === undefined
            ? undefined
            : { serverKey: HARNESS_SERVER_KEY, ownerDirectory: OWNER_DIRECTORY, rootSessionID: activeRoot },
        selectedSessionID: () => activeRoot,
        createAdapter: (target) => createNativeExecutionAdapter({ target: () => target, boundary }),
      })
      native.refresh()
    })
    syncSpans.push(performance.now() - constructed)
    liveExecution = execution

    return {
      model: execution.model,
      snapshot: () => execution.bridge.getSnapshot(),
      async reconcile() {
        const start = performance.now()
        execution.bridge.reconcile()
        native.refresh()
        syncSpans.push(performance.now() - start)
        await flush()
      },
      attach(nextRunID) {
        if (!runs.has(runKeyOf(input.rootSessionID, nextRunID))) {
          runs.set(runKeyOf(input.rootSessionID, nextRunID), runSnapshot(input.rootSessionID, nextRunID))
        }
        activeRoot = input.rootSessionID
        activeRun = nextRunID
        execution.bridge.attach(nextRunID)
      },
      dispose() {
        execution.dispose()
        native.dispose()
        disposeRoot()
        if (liveExecution === execution) liveExecution = undefined
      },
    }
  }

  async function flush(rounds = 20) {
    for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 1))
  }

  function cacheSize() {
    const current = scope()
    if (!liveExecution || !current) return 0
    const previous = connected()
    setConnected(false)
    const size = [...runs.keys()]
      .filter((key) => key.startsWith(`${current.rootSessionID}\u0000`))
      .map((key) => key.split("\u0000")[1]!)
      .filter((runID) => {
        liveExecution!.bridge.attach(runID)
        return liveExecution!.bridge.getSnapshot() !== undefined
      }).length
    setConnected(previous)
    return size
  }

  return {
    open,
    listenerCount: () => events.count(),
    intervalCount: () => clock.active(),
    cacheSize,
    maxConcurrentDetails: () => detailState.max,
    maxSyncSpanMs: () => Math.max(0, ...syncSpans),
    runCallCount: () => runCalls.length,
    async closedDashboardFullRunPolls(rounds = 10) {
      const view = open({ rootSessionID: "root-closed-polls", runID: "run", visible: false })
      await view.reconcile()
      const before = runCalls.length
      for (let index = 0; index < rounds; index += 1) clock.advance(EXECUTION_RECONCILE_INTERVAL)
      await flush(3)
      const polls = runCalls.length - before
      view.dispose()
      return polls
    },
    setVisible: (next) => {
      setVisibleSignal(next)
      liveExecution?.bridge.reconcile()
    },
    setConnected: (next) => {
      setConnected(next)
      liveExecution?.bridge.reconcile()
    },
    emitChanged(rootSessionID, runID, revision) {
      events.emit({
        id: "event-1",
        created: 1,
        type: RPC_EVENT_TYPE,
        location: { directory: OWNER_DIRECTORY },
        data: { rootSessionID, runID, revision },
      } as unknown as OpenCodeEvent)
    },
    advance: (ms) => clock.advance(ms),
    flush,
  }
}

export function measureGraphBudgets(): GraphBudgetMetrics {
  const tasks = largeTaskSet(500)
  const measure: GraphMeasurer = (task) => ({
    width: GRAPH_NODE_WIDTH,
    height: GRAPH_NODE_HEIGHT + (task.title.length % 5) * 8,
  })
  const layoutRuns: number[] = []
  for (let index = 0; index < 5; index += 1) {
    resetLayoutCache()
    const start = performance.now()
    const layout = layoutTaskGraph(tasks, measure)
    layoutRuns.push(performance.now() - start)
    if (layout.nodes.length !== 500) throw new Error("expected a 500-task layout")
  }

  const dimensionKey = graphDimensionKey({ fontSize: 13, lineHeight: 18, fontFamily: "sans-serif", scale: 1 })
  resetLayoutCache()
  const base = cachedLayout(tasks, measure, dimensionKey)
  let tokenOnlyLayouts = 0
  for (let index = 0; index < 20; index += 1) {
    const changed = tasks.map((task) => ({
      ...task,
      state: index % 2 === 0 ? ("running" as const) : ("verified" as const),
    }))
    if (cachedLayout(changed, measure, dimensionKey) !== base) tokenOnlyLayouts += 1
  }

  const longTitles = largeTaskSet(500, true)
  resetLayoutCache()
  const longBase = cachedLayout(longTitles, measure, dimensionKey)
  let longTitleLayouts = 0
  for (let index = 0; index < 5; index += 1) {
    const changed = longTitles.map((task) => ({ ...task, state: "running" as const }))
    if (cachedLayout(changed, measure, dimensionKey) !== longBase) longTitleLayouts += 1
  }

  return {
    graphLayout500Ms: Math.min(...layoutRuns),
    graphLayout500P95Ms: percentile(layoutRuns, 95),
    graphLayoutsForTokenOnlyUpdates: tokenOnlyLayouts,
    graphLayoutsForLongTitles: longTitleLayouts,
    retainedNodes: base.nodes.length,
    statusUpdateP95Ms: measureStatusUpdates(100),
  }
}

function measureStatusUpdates(count: number) {
  const tasks = largeTaskSet(count)
  const [snapshot, setSnapshot] = createSignal<RunSnapshot | undefined>(runFixture({ tasks }))
  const durations: number[] = []
  createRoot((dispose) => {
    const model = createExecutionModel({ snapshot })
    for (let index = 0; index < 50; index += 1) {
      setSnapshot(
        runFixture({
          revision: index + 2,
          tasks: tasks.map((task, taskIndex) => ({
            ...task,
            state: taskIndex % 2 === index % 2 ? ("running" as const) : ("verified" as const),
          })),
        }),
      )
      const start = performance.now()
      model.run()
      model.progress()
      model.attention()
      model.agentRows()
      durations.push(performance.now() - start)
    }
    dispose()
  })
  return percentile(durations, 95)
}

function largeTaskSet(count: number, longTitle = false) {
  const id = (index: number) => `task-${String(index).padStart(3, "0")}`
  return Array.from({ length: count }, (_, index) =>
    taskFixture({
      id: id(index),
      title: longTitle ? `Task ${id(index)} ${"x".repeat(160)}` : `Task ${id(index)}`,
      phase: index % 4 === 0 ? "Build" : "Verify",
      order: index,
      dependsOn: index % 25 === 0 ? [] : [id(index - 1)],
    }),
  )
}

function runSnapshot(rootSessionID: string, runID: string, tasks = [taskFixture()]) {
  return runFixture({ runID, rootSessionID, ownerDirectory: OWNER_DIRECTORY, tasks })
}

function summaryOf(snapshot: RunSnapshot): RunSummary {
  return {
    runID: snapshot.runID,
    rootSessionID: snapshot.rootSessionID,
    ownerDirectory: snapshot.ownerDirectory,
    title: snapshot.title,
    status: snapshot.status,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    planRevision: snapshot.plan.revision,
    progress: {
      verified: 0,
      total: snapshot.tasks.length,
      skipped: 0,
      failed: 0,
      blocked: 0,
      awaitingReview: 0,
      percent: 0,
      source: "controller_report",
    },
  }
}

function nativeInfo(sessionID: string, rootSessionID: string | undefined, longTitle: boolean): NativeSessionInfo {
  const title = longTitle ? `${sessionID} ${"y".repeat(160)}` : `${sessionID} session`
  if (sessionID === rootSessionID) return { id: sessionID, title, directory: OWNER_DIRECTORY }
  return { id: sessionID, parentID: rootSessionID, title, directory: OWNER_DIRECTORY }
}

function trackedEvents() {
  const listeners = new Set<(event: OpenCodeEvent) => void>()
  return {
    source: {
      listen(handler: (event: OpenCodeEvent) => void) {
        listeners.add(handler)
        return () => {
          listeners.delete(handler)
        }
      },
    } satisfies ExecutionEventSource,
    emit(event: OpenCodeEvent) {
      for (const listener of [...listeners]) listener(event)
    },
    count: () => listeners.size,
  }
}

function fakeClock() {
  let next = 0
  let now = 0
  const timers = new Map<number, () => void>()
  return {
    clock: {
      now: () => now,
      setInterval: (handler: () => void) => {
        next += 1
        timers.set(next, handler)
        return next
      },
      clearInterval: (handle: unknown) => {
        timers.delete(handle as number)
      },
    },
    advance(ms: number) {
      now += ms
      for (const handler of [...timers.values()]) handler()
    },
    active: () => timers.size,
  }
}
