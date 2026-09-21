import { describe, expect, test } from "bun:test"
import { ClientError, type OpenCodeEvent, type RpcCallOptions, type RpcClient } from "@opencode/client/promise"
import type { Changed, RunSnapshot } from "@bearmanser/opencode-superpowers-execution/contract"
import { ExecutionRpc, RunSnapshotSchema } from "@bearmanser/opencode-superpowers-execution/contract"
import { createRoot, createSignal } from "solid-js"
import {
  EXECUTION_RECONCILE_INTERVAL,
  createExecutionBridge,
  shouldApplySnapshot,
  type ExecutionClock,
} from "./bridge-client"
import { failedTaskFixture, runFixture } from "./fixtures"
import type { ExecutionScope } from "./identity"
import { createExecutionModel, type ExecutionModel } from "./model"
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

function changedEvent(directory: string, data: Changed) {
  return {
    id: "event-1",
    created: 1,
    type: RPC_EVENT_TYPE,
    location: { directory },
    data,
  } as unknown as OpenCodeEvent
}

type BridgeHarness = {
  model: ExecutionModel
  clock: FakeClock
  getRunCalls: RequestCall[]
  attach(scope: ExecutionScope, runID: string): Reply
  next(scope: ExecutionScope, runID: string): Reply
  setScope(scope: ExecutionScope): void
  setConnected(connected: boolean): void
  setVisible(visible: boolean): void
  setCapabilitiesVersion(version: number): void
  failCapabilities(error: unknown): void
  clearCapabilitiesError(): void
  emit(data: Changed, directory?: string): void
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
  let capabilitiesError: unknown

  const key = (ownerDirectory: string | undefined, runID: string) => `${ownerDirectory ?? ""}\u0000${runID}`
  const enqueue = (target: ExecutionScope, runID: string): Reply => {
    const reply = deferred<RunSnapshot>()
    replies.set(key(target.ownerDirectory, runID), reply)
    return reply
  }

  const api = {
    capabilities: async () => {
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
    listRuns: async () => ({ items: [] }),
    getSummaries: async () => ({ items: [] }),
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
    bridge = createExecutionBridge({ scope, api, events: events.source, connection: connected, visible, clock: clock.clock })
    model = createExecutionModel({
      scope,
      mode: () => bridge.getMode(),
      snapshot: () => bridge.getSnapshot(),
      reconcile: () => bridge.reconcile(),
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
    next(target, runID) {
      return enqueue(target, runID)
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
    failCapabilities(error) {
      capabilitiesError = error
    },
    clearCapabilitiesError() {
      capabilitiesError = undefined
    },
    emit(data, directory) {
      events.emit(changedEvent(directory ?? (scope()?.ownerDirectory ?? "/"), data))
    },
    async flush() {
      for (let index = 0; index < 25; index += 1) await Promise.resolve()
    },
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
    harness.setConnected(true)
    await harness.flush()
    expect(harness.getRunCalls).toHaveLength(1)
    first.resolve(runFixture({ revision: 1 }))
    await harness.flush()
    expect(harness.model.mode()).toBe("ready")
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
    expect(unauthorized.getRunCalls).toHaveLength(0)
    unauthorized.dispose()

    const absent = bridgeHarness()
    absent.failCapabilities({ type: "rpc.unavailable", message: "RPC is unavailable: superpowers.execution.v1" })
    absent.attach(SCOPE, "run-1")
    await absent.flush()
    expect(absent.model.mode()).toBe("observer")
    expect(absent.getRunCalls).toHaveLength(0)
    absent.dispose()
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
})
