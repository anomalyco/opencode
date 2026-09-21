import { describe, expect, test } from "bun:test"
import { ClientError, type OpenCodeEvent, type RpcCallOptions, type RpcClient } from "@opencode/client/promise"
import type { Changed, RunSnapshot, RunSummary } from "@bearmanser/opencode-superpowers-execution/contract"
import { ExecutionRpc, RunSnapshotSchema } from "@bearmanser/opencode-superpowers-execution/contract"
import { createRoot, createSignal } from "solid-js"
import {
  EXECUTION_RECONCILE_INTERVAL,
  createExecutionBridge,
  createSessionExecution,
  preferredRun,
  shouldApplySnapshot,
  type ExecutionClock,
  type SessionExecution,
} from "./bridge-client"
import { failedTaskFixture, runFixture } from "./fixtures"
import type { ExecutionScope } from "./identity"
import { createExecutionModel, structuredViewsEnabled, type ExecutionModel } from "./model"
import { attentionState } from "./status-badge"

const RPC_EVENT_TYPE = "rpc.superpowers.execution.v1.changed"
const SCOPE: ExecutionScope = { serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: "root" }

type Reply = {
  promise: Promise<RunSnapshot>
  resolve(snapshot: RunSnapshot): void
  reject(error: unknown): void
}

type RequestCall = {
  ownerDirectory: string | undefined
  rootSessionID: string
  runID: string
}

type FakeClock = {
  clock: ExecutionClock
  advance(ms: number): void
  active(): number
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeClock(): FakeClock {
  let next = 0
  let now = 0
  const timers = new Map<number, () => void>()
  return {
    clock: {
      now: () => now,
      setInterval: (handler) => {
        next += 1
        timers.set(next, handler)
        return next
      },
      clearInterval: (handle) => {
        timers.delete(handle as number)
      },
    },
    advance(ms) {
      now += ms
      for (const handler of [...timers.values()]) handler()
    },
    active: () => timers.size,
  }
}

function localEvents() {
  const listeners = new Set<(event: OpenCodeEvent) => void>()
  return {
    source: {
      listen(handler: (event: OpenCodeEvent) => void) {
        listeners.add(handler)
        return () => {
          listeners.delete(handler)
        }
      },
    },
    emit(event: OpenCodeEvent) {
      for (const listener of [...listeners]) listener(event)
    },
    count: () => listeners.size,
  }
}

function changedEvent(directory: string | undefined, data: Changed) {
  const location = directory === undefined ? undefined : { directory }
  return {
    id: "event-1",
    created: 1,
    type: RPC_EVENT_TYPE,
    location,
    data,
  } as unknown as OpenCodeEvent
}

function summaryFixture(scope: ExecutionScope, runID: string, revision = 1): RunSummary {
  return {
    runID,
    rootSessionID: scope.rootSessionID,
    ownerDirectory: scope.ownerDirectory,
    title: `Run ${runID}`,
    status: "active",
    revision,
    updatedAt: 1_700_000_000_000,
    planRevision: 1,
    progress: {
      verified: 0,
      total: 1,
      skipped: 0,
      failed: 0,
      blocked: 0,
      awaitingReview: 0,
      percent: 0,
      source: "controller_report",
    },
  }
}

async function flush() {
  for (let index = 0; index < 25; index += 1) await Promise.resolve()
}

type BridgeHarness = {
  model: ExecutionModel
  clock: FakeClock
  getRunCalls: RequestCall[]
  attach(scope: ExecutionScope, runID: string): Reply
  attachActive(scope: ExecutionScope, runID?: string): Reply | undefined
  next(scope: ExecutionScope, runID: string): Reply
  setSummaries(items: RunSummary[]): void
  setScope(scope: ExecutionScope): void
  setConnected(connected: boolean): void
  setVisible(visible: boolean): void
  setCapabilitiesVersion(version: number): void
  capabilityCalls(): number
  pauseCapabilities(): void
  resumeCapabilities(): void
  failCapabilities(error: unknown): void
  clearCapabilitiesError(): void
  emit(data: Changed, directory?: string): void
  emitUnlocated(data: Changed): void
  events: ReturnType<typeof localEvents>
  flush(): Promise<void>
  dispose(): void
}

function bridgeHarness(): BridgeHarness {
  const clock = fakeClock()
  const events = localEvents()
  const [scope, setScope] = createSignal<ExecutionScope | undefined>()
  const [connected, setConnectedSignal] = createSignal(true)
  const [visible, setVisibleSignal] = createSignal(true)
  const replies = new Map<string, Reply>()
  const getRunCalls: RequestCall[] = []
  let capabilitiesVersion = 1
  let capabilitiesCalls = 0
  let capabilitiesError: unknown
  let capabilitiesGate: ReturnType<typeof deferred<void>> | undefined
  let summaries: RunSummary[] = []

  const key = (ownerDirectory: string | undefined, runID: string) => `${ownerDirectory ?? ""}\u0000${runID}`
  const enqueue = (target: ExecutionScope, runID: string): Reply => {
    const reply = deferred<RunSnapshot>()
    replies.set(key(target.ownerDirectory, runID), reply)
    return reply
  }

  const api = {
    capabilities: async () => {
      capabilitiesCalls += 1
      await capabilitiesGate?.promise
      if (capabilitiesError) throw capabilitiesError
      return { schemaVersion: capabilitiesVersion, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }
    },
    getRun: async (input: { rootSessionID: string; runID: string }, options?: RpcCallOptions) => {
      const ownerDirectory = options?.location?.directory
      getRunCalls.push({ ownerDirectory, rootSessionID: input.rootSessionID, runID: input.runID })
      const reply = replies.get(key(ownerDirectory, input.runID))
      replies.delete(key(ownerDirectory, input.runID))
      if (!reply) throw new Error(`unexpected getRun for ${ownerDirectory ?? "?"}/${input.runID}`)
      return reply.promise
    },
    getSummaries: async () => ({ items: summaries }),
    listRuns: async () => ({ items: [] }),
    events: {
      subscribe: () => {
        throw new Error("events.subscribe is not used by the bridge")
      },
      on: () => () => {},
    },
  } as unknown as RpcClient<typeof ExecutionRpc, RpcCallOptions>

  let model!: ExecutionModel
  let disposeRoot!: () => void
  let bridge!: ReturnType<typeof createExecutionBridge>

  createRoot((dispose) => {
    disposeRoot = dispose
    bridge = createExecutionBridge({
      scope,
      api: () => api,
      events: events.source,
      connection: connected,
      visible,
      clock: clock.clock,
    })
    model = createExecutionModel({
      scope,
      mode: () => bridge.getMode(),
      reason: () => bridge.getReason(),
      snapshot: () => bridge.getSnapshot(),
      reconcile: () => bridge.reconcile(),
      selectRun: (runID) => (runID === undefined ? bridge.attachActive() : bridge.attach(runID)),
    })
  })

  return {
    model,
    clock,
    getRunCalls,
    events,
    attach(target, runID) {
      setScope(target)
      const reply = enqueue(target, runID)
      bridge.attach(runID)
      return reply
    },
    attachActive(target, runID) {
      setScope(target)
      summaries = runID ? [summaryFixture(target, runID)] : []
      const reply = runID ? enqueue(target, runID) : undefined
      bridge.attachActive()
      return reply
    },
    next(target, runID) {
      return enqueue(target, runID)
    },
    setSummaries(items) {
      summaries = items
    },
    setScope,
    setConnected(next) {
      setConnectedSignal(next)
      bridge.reconcile()
    },
    setVisible(next) {
      setVisibleSignal(next)
      bridge.reconcile()
    },
    setCapabilitiesVersion(version) {
      capabilitiesVersion = version
    },
    capabilityCalls: () => capabilitiesCalls,
    pauseCapabilities() {
      capabilitiesGate = deferred<void>()
    },
    resumeCapabilities() {
      capabilitiesGate?.resolve()
      capabilitiesGate = undefined
    },
    failCapabilities(error) {
      capabilitiesError = error
    },
    clearCapabilitiesError() {
      capabilitiesError = undefined
    },
    emit(data, directory) {
      events.emit(changedEvent(directory ?? (scope()?.ownerDirectory ?? "/"), data))
    },
    emitUnlocated(data) {
      events.emit(changedEvent(undefined, data))
    },
    flush,
    dispose() {
      bridge.dispose()
      disposeRoot()
    },
  }
}

describe("shouldApplySnapshot", () => {
  test("accepts the active generation and an equal or newer revision", () => {
    expect(
      shouldApplySnapshot({ requestGeneration: 1, activeGeneration: 1, incomingRevision: 2, currentRevision: 2 }),
    ).toBe(true)
    expect(
      shouldApplySnapshot({ requestGeneration: 1, activeGeneration: 1, incomingRevision: 3, currentRevision: 2 }),
    ).toBe(true)
    expect(
      shouldApplySnapshot({ requestGeneration: 1, activeGeneration: 2, incomingRevision: 9, currentRevision: 1 }),
    ).toBe(false)
    expect(
      shouldApplySnapshot({ requestGeneration: 1, activeGeneration: 1, incomingRevision: 1, currentRevision: 2 }),
    ).toBe(false)
  })
})

test("the frontend run fixture is contract valid", () => {
  expect(RunSnapshotSchema.safeParse(runFixture()).success).toBe(true)
  expect(RunSnapshotSchema.safeParse(runFixture({ tasks: [failedTaskFixture()] })).success).toBe(true)
})

test("structured views are disabled only for an incompatible schema", () => {
  expect(structuredViewsEnabled("ready")).toBe(true)
  expect(structuredViewsEnabled("stale")).toBe(true)
  expect(structuredViewsEnabled("observer")).toBe(true)
  expect(structuredViewsEnabled("unavailable")).toBe(true)
  expect(structuredViewsEnabled("incompatible")).toBe(false)
})

test("preferredRun chooses the active run and then the latest update", () => {
  const completedOlder = { ...summaryFixture(SCOPE, "run-old"), status: "completed" as const, updatedAt: 5 }
  const completedNewer = { ...summaryFixture(SCOPE, "run-new"), status: "completed" as const, updatedAt: 9 }
  const active = { ...summaryFixture(SCOPE, "run-active"), updatedAt: 1 }
  expect(preferredRun([completedOlder, completedNewer])?.runID).toBe("run-new")
  expect(preferredRun([completedNewer, active])?.runID).toBe("run-active")
  expect(preferredRun([])).toBeUndefined()
})

describe("createExecutionBridge", () => {
  test("late snapshot from an old attachment cannot replace the new run", async () => {
    const harness = bridgeHarness()
    const old = harness.attach({ serverKey: "a", ownerDirectory: "/a", rootSessionID: "root" }, "run-1")
    const current = harness.attach({ serverKey: "b", ownerDirectory: "/b", rootSessionID: "root" }, "run-1")
    current.resolve(runFixture({ revision: 9, ownerDirectory: "/b" }))
    await harness.flush()
    old.resolve(runFixture({ revision: 10, ownerDirectory: "/a" }))
    await harness.flush()
    expect(harness.model.scope()?.serverKey).toBe("b")
    expect(harness.model.run()?.ownerDirectory).toBe("/b")
    expect(harness.model.run()?.revision).toBe(9)
    harness.dispose()
  })

  test("an event during the first fetch triggers exactly one follow-up fetch", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    const follow = harness.next(SCOPE, "run-1")
    harness.emit({ rootSessionID: "root", runID: "run-1", revision: 2 })
    await harness.flush()
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(2)
    follow.resolve(runFixture({ revision: 2 }))
    await harness.flush()
    expect(harness.model.run()?.revision).toBe(2)
    harness.dispose()
  })

  test("a lower event revision never regresses the snapshot", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 5 }))
    await harness.flush()
    expect(harness.model.run()?.revision).toBe(5)
    harness.emit({ rootSessionID: "root", runID: "run-1", revision: 4 })
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    expect(harness.model.run()?.revision).toBe(5)
    harness.dispose()
  })

  test("a duplicate event does not fetch again", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 5 }))
    await harness.flush()
    harness.emit({ rootSessionID: "root", runID: "run-1", revision: 5 })
    harness.emit({ rootSessionID: "root", runID: "run-1", revision: 5 })
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    harness.dispose()
  })

  test("an unscoped event cannot trigger a fetch", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    harness.emitUnlocated({ rootSessionID: "root", runID: "run-1", revision: 2 })
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    expect(harness.model.run()?.revision).toBe(1)
    harness.dispose()
  })

  test("a lost event is recovered by reconcile", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    const follow = harness.next(SCOPE, "run-1")
    harness.model.reconcile()
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(2)
    follow.resolve(runFixture({ revision: 2 }))
    await harness.flush()
    expect(harness.model.run()?.revision).toBe(2)
    harness.dispose()
  })

  test("offline attaches nothing and reconnecting fetches", async () => {
    const harness = bridgeHarness()
    harness.setConnected(false)
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(0)
    expect(harness.model.mode()).toBe("observer")
    expect(harness.model.reason()).toBe("offline")
    harness.setConnected(true)
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.model.mode()).toBe("ready")
    harness.dispose()
  })

  test("automatic selection resumes discovery after starting offline", async () => {
    const harness = bridgeHarness()
    harness.setConnected(false)
    const first = harness.attachActive(SCOPE, "run-1")
    await harness.flush()
    expect(harness.capabilityCalls()).toBe(0)

    harness.setConnected(true)
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    first?.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-1")
    harness.dispose()
  })

  test("reconnecting reselects a newly preferred run for an automatic attachment", async () => {
    const harness = bridgeHarness()
    const first = harness.attachActive(SCOPE, "run-1")
    await harness.flush()
    first?.resolve(runFixture({ runID: "run-1", revision: 1 }))
    await harness.flush()

    harness.setConnected(false)
    harness.setSummaries([summaryFixture(SCOPE, "run-2", 1)])
    const second = harness.next(SCOPE, "run-2")
    harness.setConnected(true)
    await harness.flush()

    expect(harness.getRunCalls.at(-1)?.runID).toBe("run-2")
    second.resolve(runFixture({ runID: "run-2", revision: 1 }))
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-2")
    harness.dispose()
  })

  test("a scope change during automatic discovery cannot attach the previous root", async () => {
    const harness = bridgeHarness()
    const nextScope = { ...SCOPE, rootSessionID: "root-b" }
    harness.attachActive(SCOPE, "run-1")
    const current = harness.attachActive(nextScope, "run-2")
    await harness.flush()

    expect(harness.getRunCalls.at(-1)).toMatchObject({ rootSessionID: "root-b", runID: "run-2" })
    current?.resolve(runFixture({ rootSessionID: "root-b", runID: "run-2" }))
    await harness.flush()
    expect(harness.model.run()?.rootSessionID).toBe("root-b")
    harness.dispose()
  })

  test("an incompatible schema disables structured views without retrying", async () => {
    const harness = bridgeHarness()
    harness.failCapabilities({
      type: "execution",
      message: "unsupported schema",
      data: { code: "incompatible_schema", detail: "unsupported schema" },
    })
    harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.model.mode()).toBe("incompatible")
    expect(harness.model.reason()).toBe("incompatible_schema")
    expect(harness.model.run()).toBeUndefined()
    expect(harness.model.progress()).toBeUndefined()
    expect(harness.model.attention().failed).toBe(0)
    expect(harness.getRunCalls).toHaveLength(0)
    harness.model.reconcile()
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(0)
    harness.dispose()
  })

  test("a newer capability schema version is incompatible", async () => {
    const harness = bridgeHarness()
    harness.setCapabilitiesVersion(2)
    harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.model.mode()).toBe("incompatible")
    expect(harness.model.reason()).toBe("incompatible_schema")
    expect(harness.getRunCalls).toHaveLength(0)
    harness.dispose()
  })

  test("reconnecting re-probes an incompatible schema instead of retrying it", async () => {
    const harness = bridgeHarness()
    harness.setCapabilitiesVersion(2)
    harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.model.mode()).toBe("incompatible")
    harness.setConnected(false)
    harness.setCapabilitiesVersion(1)
    const recovered = harness.next(SCOPE, "run-1")
    harness.setConnected(true)
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    recovered.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.model.mode()).toBe("ready")
    harness.dispose()
  })

  test("a 401 is unavailable while an absent plugin is observer", async () => {
    const unauthorized = bridgeHarness()
    unauthorized.failCapabilities(new ClientError("UnexpectedStatus", { cause: { status: 401 } }))
    unauthorized.attach(SCOPE, "run-1")
    await unauthorized.flush()
    expect(unauthorized.model.mode()).toBe("unavailable")
    expect(unauthorized.model.reason()).toBe("auth")
    expect(unauthorized.getRunCalls).toHaveLength(0)
    unauthorized.dispose()

    const absent = bridgeHarness()
    absent.failCapabilities({ type: "rpc.unavailable", message: "RPC is unavailable: superpowers.execution.v1" })
    absent.attach(SCOPE, "run-1")
    await absent.flush()
    expect(absent.model.mode()).toBe("observer")
    expect(absent.model.reason()).toBe("plugin_absent")
    expect(absent.getRunCalls).toHaveLength(0)
    absent.dispose()
  })

  test("plugin absence and no registered run are distinct observer reasons", async () => {
    const absent = bridgeHarness()
    absent.failCapabilities({ type: "rpc.method_not_found", message: "Unknown RPC method" })
    absent.attachActive(SCOPE, "run-1")
    await absent.flush()
    expect(absent.model.mode()).toBe("observer")
    expect(absent.model.reason()).toBe("plugin_absent")
    absent.dispose()

    const empty = bridgeHarness()
    empty.attachActive(SCOPE)
    await empty.flush()
    expect(empty.model.mode()).toBe("observer")
    expect(empty.model.reason()).toBe("no_run")
    expect(empty.getRunCalls).toHaveLength(0)
    empty.dispose()
  })

  test("a run registered after an empty attach is discovered by the safety poll", async () => {
    const harness = bridgeHarness()
    harness.attachActive(SCOPE)
    await harness.flush()
    expect(harness.model.reason()).toBe("no_run")
    const reply = harness.next(SCOPE, "run-9")
    harness.setSummaries([summaryFixture(SCOPE, "run-9")])
    harness.clock.advance(EXECUTION_RECONCILE_INTERVAL)
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    expect(harness.getRunCalls[0]?.runID).toBe("run-9")
    reply.resolve(runFixture({ runID: "run-9", revision: 2 }))
    await harness.flush()
    expect(harness.model.mode()).toBe("ready")
    expect(harness.model.run()?.runID).toBe("run-9")
    harness.dispose()
  })

  test("automatic selection adopts a newer run after the displayed run completes", async () => {
    const harness = bridgeHarness()
    const first = harness.attachActive(SCOPE, "run-1")
    await harness.flush()
    first?.resolve(runFixture({ runID: "run-1", revision: 4, status: "completed" }))
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-1")

    const second = harness.next(SCOPE, "run-2")
    harness.setSummaries([summaryFixture(SCOPE, "run-2", 1)])
    harness.emit({ rootSessionID: "root", runID: "run-2", revision: 1 })
    await harness.flush()
    expect(harness.getRunCalls.at(-1)?.runID).toBe("run-2")
    second.resolve(runFixture({ runID: "run-2", revision: 1 }))
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-2")
    harness.dispose()
  })

  test("explicit historical selection stays pinned while automatic selection can be restored", async () => {
    const harness = bridgeHarness()
    const historical = harness.attach(SCOPE, "run-1")
    await harness.flush()
    historical.resolve(runFixture({ runID: "run-1", revision: 4, status: "completed" }))
    await harness.flush()

    harness.setSummaries([summaryFixture(SCOPE, "run-2")])
    harness.emit({ rootSessionID: "root", runID: "run-2", revision: 1 })
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-1")

    const current = harness.next(SCOPE, "run-2")
    harness.model.selectRun(undefined)
    await harness.flush()
    current.resolve(runFixture({ runID: "run-2", revision: 1 }))
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-2")
    harness.dispose()
  })

  test("schema mismatch during discovery stops polling until reconnection", async () => {
    const harness = bridgeHarness()
    harness.setCapabilitiesVersion(2)
    harness.attachActive(SCOPE)
    await harness.flush()
    expect(harness.model.mode()).toBe("incompatible")
    expect(harness.capabilityCalls()).toBe(1)
    expect(harness.clock.active()).toBe(0)

    harness.clock.advance(EXECUTION_RECONCILE_INTERVAL * 2)
    await harness.flush()
    expect(harness.capabilityCalls()).toBe(1)

    harness.setConnected(false)
    harness.setCapabilitiesVersion(1)
    harness.setConnected(true)
    await harness.flush()
    expect(harness.capabilityCalls()).toBe(2)
    harness.dispose()
  })

  test("attachActive resolves the preferred summary and fetches that run", async () => {
    const harness = bridgeHarness()
    const reply = harness.attachActive(SCOPE, "run-7")
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    expect(harness.getRunCalls[0]?.runID).toBe("run-7")
    expect(harness.getRunCalls[0]?.ownerDirectory).toBe(SCOPE.ownerDirectory)
    reply?.resolve(runFixture({ runID: "run-7", revision: 3 }))
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-7")
    expect(harness.model.run()?.revision).toBe(3)
    harness.dispose()
  })

  test("a plugin unload keeps a stale snapshot and a reload recovers", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.model.mode()).toBe("ready")

    const unloaded = harness.next(SCOPE, "run-1")
    harness.model.reconcile()
    await harness.flush()
    unloaded.reject({ type: "rpc.unavailable", message: "RPC is unavailable: superpowers.execution.v1" })
    await harness.flush()
    expect(harness.model.mode()).toBe("stale")
    expect(harness.model.reason()).toBe("plugin_absent")
    expect(harness.model.run()?.revision).toBe(1)

    const reloaded = harness.next(SCOPE, "run-1")
    harness.model.reconcile()
    await harness.flush()
    reloaded.resolve(runFixture({ revision: 2 }))
    await harness.flush()
    expect(harness.model.mode()).toBe("ready")
    expect(harness.model.run()?.revision).toBe(2)
    harness.dispose()
  })

  test("a selected child worktree does not change the attached owner directory", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    harness.setScope({ serverKey: "wsl", ownerDirectory: "/root/git/demo/.worktrees/feature", rootSessionID: "root" })
    const follow = harness.next(SCOPE, "run-1")
    harness.model.reconcile()
    await harness.flush()
    expect(harness.getRunCalls.every((call) => call.ownerDirectory === SCOPE.ownerDirectory)).toBe(true)
    follow.resolve(runFixture({ revision: 2 }))
    await harness.flush()
    expect(harness.model.run()?.ownerDirectory).toBe(SCOPE.ownerDirectory)
    harness.dispose()
  })

  test("a same-root owner location change pauses tracking and retains the snapshot", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 3, ownerDirectory: SCOPE.ownerDirectory }))
    await harness.flush()
    expect(harness.model.mode()).toBe("ready")

    harness.attachActive({
      serverKey: SCOPE.serverKey,
      ownerDirectory: "/root/git/demo/moved",
      rootSessionID: SCOPE.rootSessionID,
    })
    await harness.flush()
    expect(harness.model.mode()).toBe("stale")
    expect(harness.model.reason()).toBe("location_changed")
    expect(harness.model.run()?.revision).toBe(3)
    expect(harness.getRunCalls.every((call) => call.ownerDirectory === SCOPE.ownerDirectory)).toBe(true)
    harness.dispose()
  })

  test("recently observed runs stay cached within one scope", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    const second = harness.attach(SCOPE, "run-2")
    await harness.flush()
    second.resolve(runFixture({ runID: "run-2", revision: 3 }))
    await harness.flush()
    harness.attach(SCOPE, "run-1")
    expect(harness.model.run()?.runID).toBe("run-1")
    expect(harness.model.run()?.revision).toBe(1)
    harness.dispose()
  })

  test("one safety timer suspends while hidden and resumes when visible", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.clock.active()).toBe(1)
    harness.setVisible(false)
    expect(harness.clock.active()).toBe(0)
    const follow = harness.next(SCOPE, "run-1")
    harness.setVisible(true)
    await harness.flush()
    expect(harness.clock.active()).toBe(1)
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(2)
    follow.resolve(runFixture({ revision: 2 }))
    await harness.flush()
    expect(harness.model.run()?.revision).toBe(2)
    harness.dispose()
  })

  test("expanding the presentation does not add a second reconciliation owner", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.clock.active()).toBe(1)
    harness.model.setExpanded(true)
    expect(harness.clock.active()).toBe(1)
    harness.model.setExpanded(false)
    expect(harness.clock.active()).toBe(1)
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.model.run()?.runID).toBe("run-1")
    harness.dispose()
    expect(harness.clock.active()).toBe(0)
  })

  test("the safety timer reconciles one bounded run poll each interval", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    const follow = harness.next(SCOPE, "run-1")
    harness.clock.advance(EXECUTION_RECONCILE_INTERVAL)
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(2)
    follow.resolve(runFixture({ revision: 2 }))
    await harness.flush()
    expect(harness.model.run()?.revision).toBe(2)
    harness.dispose()
  })

  test("the automatic safety timer performs one snapshot fetch per interval", async () => {
    const harness = bridgeHarness()
    const first = harness.attachActive(SCOPE, "run-1")
    await harness.flush()
    first?.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    const before = harness.getRunCalls.length
    const follow = harness.next(SCOPE, "run-1")
    harness.pauseCapabilities()

    harness.clock.advance(EXECUTION_RECONCILE_INTERVAL)
    await harness.flush()
    harness.resumeCapabilities()
    await harness.flush()
    follow.resolve(runFixture({ revision: 2 }))
    await harness.flush()

    expect(harness.getRunCalls).toHaveLength(before + 1)
    expect(harness.model.run()?.revision).toBe(2)
    harness.dispose()
  })

  test("at most one snapshot fetch is in flight per run", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    harness.emit({ rootSessionID: "root", runID: "run-1", revision: 2 })
    harness.emit({ rootSessionID: "root", runID: "run-1", revision: 3 })
    harness.model.reconcile()
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    const follow = harness.next(SCOPE, "run-1")
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(2)
    follow.resolve(runFixture({ revision: 3 }))
    await harness.flush()
    expect(harness.model.run()?.revision).toBe(3)
    harness.dispose()
  })

  test("dispose stops the timer, the listener, and late snapshots", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    harness.dispose()
    expect(harness.clock.active()).toBe(0)
    expect(harness.events.count()).toBe(0)
    first.resolve(runFixture({ revision: 4 }))
    await harness.flush()
    expect(harness.model.run()).toBeUndefined()
  })

  test("a bridge-reported failed task enters failure attention and survives a stale outage", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(runFixture({ revision: 2, tasks: [failedTaskFixture()] }))
    await harness.flush()
    expect(harness.model.attention().failed).toBe(1)
    expect(harness.model.progress()?.failed).toBe(1)
    expect(attentionState(harness.model.attention())).toBe("failed")

    const follow = harness.next(SCOPE, "run-1")
    harness.model.reconcile()
    await harness.flush()
    follow.reject(new Error("transient transport failure"))
    await harness.flush()
    expect(harness.model.mode()).toBe("stale")
    expect(harness.model.attention().failed).toBe(1)
    harness.dispose()
  })

  test("a bridge-reported blocked task merges into blocked attention", async () => {
    const harness = bridgeHarness()
    const first = harness.attach(SCOPE, "run-1")
    await harness.flush()
    first.resolve(
      runFixture({ revision: 2, tasks: [failedTaskFixture({ id: "task-blocked", state: "blocked" })] }),
    )
    await harness.flush()
    expect(harness.model.attention().blocked).toBe(1)
    expect(harness.model.progress()?.blocked).toBe(1)
    harness.dispose()
  })
})

test("the production session composition tracks failures while the execution tab is closed", async () => {
  const calls: string[] = []
  const pending: Array<{ resolve: (snapshot: RunSnapshot) => void }> = []
  const rpc = {
    capabilities: async () => {
      calls.push("capabilities")
      return { schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }
    },
    getSummaries: async () => {
      calls.push("getSummaries")
      return {
        items: [
          { ...summaryFixture(SCOPE, "run-completed"), status: "completed" as const, updatedAt: 9 },
          summaryFixture(SCOPE, "run-active"),
        ],
      }
    },
    getRun: async () => {
      calls.push("getRun")
      return new Promise<RunSnapshot>((resolve) => pending.push({ resolve }))
    },
    listRuns: async () => ({ items: [] }),
    events: {
      subscribe: () => {
        throw new Error("events.subscribe is not used by the bridge")
      },
      on: () => () => {},
    },
  } as unknown as RpcClient<typeof ExecutionRpc, RpcCallOptions>
  const events = localEvents()
  const clock = fakeClock()
  const [scope] = createSignal<ExecutionScope | undefined>(SCOPE)
  const [connected] = createSignal(true)
  const [visible, setVisible] = createSignal(false)
  let execution!: SessionExecution
  createRoot(() => {
    execution = createSessionExecution({
      scope,
      api: () => rpc,
      events: events.source,
      connection: connected,
      visible,
      clock: clock.clock,
      attention: () => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 }),
    })
  })
  await flush()
  expect(visible()).toBe(false)
  expect(calls).toEqual(["capabilities", "getSummaries", "getRun"])
  pending[0]!.resolve(runFixture({ runID: "run-active", revision: 2, tasks: [failedTaskFixture()] }))
  await flush()
  expect(execution.model.attention().failed).toBe(1)
  expect(attentionState(execution.model.attention())).toBe("failed")
  expect(clock.active()).toBe(0)

  events.emit(changedEvent(SCOPE.ownerDirectory, { rootSessionID: "root", runID: "run-active", revision: 3 }))
  await flush()
  expect(calls.filter((call) => call === "getRun")).toHaveLength(2)
  pending[1]!.resolve(
    runFixture({ runID: "run-active", revision: 3, tasks: [failedTaskFixture(), failedTaskFixture({ id: "task-failed-2" })] }),
  )
  await flush()
  expect(execution.model.attention().failed).toBe(2)
  expect(clock.active()).toBe(0)

  setVisible(true)
  execution.bridge.reconcile()
  expect(clock.active()).toBe(1)
  execution.dispose()
  expect(clock.active()).toBe(0)
})
