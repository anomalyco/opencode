import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, RpcCallOptions, RpcClient } from "@opencode/client/promise"
import { ExecutionRpc, type RunSummary } from "@bearmanser/opencode-superpowers-execution/contract"
import { createRoot, createSignal } from "solid-js"
import {
  consumeExecutionOverview,
  createHomeExecutionSummaries,
  homeSummaryRequests,
  requestExecutionOverview,
  summaryBatches,
} from "./home-summary"
import type { ExecutionEventSource } from "./bridge-client"
import type { ExecutionScope } from "./identity"

const RPC_EVENT_TYPE = "rpc.superpowers.execution.v1.changed"

function scope(serverKey: string, ownerDirectory: string, rootSessionID: string): ExecutionScope {
  return { serverKey, ownerDirectory, rootSessionID }
}

function summary(input: {
  rootSessionID: string
  runID: string
  status?: RunSummary["status"]
  updatedAt?: number
  verified?: number
  total?: number
}): RunSummary {
  return {
    runID: input.runID,
    rootSessionID: input.rootSessionID,
    ownerDirectory: "/a",
    title: `Run ${input.runID}`,
    status: input.status ?? "active",
    revision: 1,
    updatedAt: input.updatedAt ?? 1,
    planRevision: 1,
    progress: {
      verified: input.verified ?? 0,
      total: input.total ?? 0,
      skipped: 0,
      failed: 0,
      blocked: 0,
      awaitingReview: 0,
      percent: null,
      source: "controller_report",
    },
  }
}

type Call = {
  rootSessionIDs: string[]
  directory: string | undefined
  resolve(items: RunSummary[]): void
  reject(error: unknown): void
}

function deferred(): { promise: Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void } {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeApi() {
  const calls: Call[] = []
  const failing = new Set<string | undefined>()
  let fullRunFetches = 0
  const api = {
    getSummaries: (input: { rootSessionIDs: string[] }, options?: RpcCallOptions) => {
      const directory = options?.location?.directory
      if (failing.has(directory)) {
        calls.push({
          rootSessionIDs: input.rootSessionIDs,
          directory,
          resolve: () => undefined,
          reject: () => undefined,
        })
        return Promise.reject({ type: "rpc.unavailable", message: "RPC is unavailable" })
      }
      const next = deferred()
      options?.signal?.addEventListener("abort", () => next.reject(new Error("aborted")))
      calls.push({
        rootSessionIDs: input.rootSessionIDs,
        directory,
        resolve: (items) => next.resolve({ items }),
        reject: (error) => next.reject(error),
      })
      return next.promise
    },
    getRun: async () => {
      fullRunFetches += 1
      throw new Error("getRun is not used by Home summaries")
    },
    listRuns: async () => ({ items: [] }),
    capabilities: async () => ({ schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }),
    events: { subscribe: () => ({}) as never, on: () => () => undefined },
  } as unknown as RpcClient<typeof ExecutionRpc, RpcCallOptions>
  return {
    api,
    calls,
    fullRunFetches: () => fullRunFetches,
    failFor: (directory: string | undefined) => failing.add(directory),
    recover: () => failing.clear(),
  }
}

function localEvents() {
  const listeners = new Set<(event: OpenCodeEvent) => void>()
  const source: ExecutionEventSource = {
    listen(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  return {
    source,
    emit(data: { rootSessionID: string; runID: string; revision: number }, directory?: string) {
      const event = {
        id: "event-1",
        created: 1,
        type: RPC_EVENT_TYPE,
        location: directory === undefined ? undefined : { directory },
        data,
      } as unknown as OpenCodeEvent
      for (const listener of [...listeners]) listener(event)
    },
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function run(assert: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      assert().then(
        () => {
          dispose()
          resolve()
        },
        (error) => {
          dispose()
          reject(error)
        },
      )
    })
  })
}

describe("summaryBatches", () => {
  test("splits unique roots into batches of at most fifty", () => {
    expect(summaryBatches([])).toEqual([])
    expect(summaryBatches(["a"])).toEqual([["a"]])
    expect(summaryBatches(Array.from({ length: 50 }, (_, index) => `root-${index}`))).toHaveLength(1)
    const fiftyOne = summaryBatches(Array.from({ length: 51 }, (_, index) => `root-${index}`))
    expect(fiftyOne.map((batch) => batch.length)).toEqual([50, 1])
    const many = summaryBatches(Array.from({ length: 120 }, (_, index) => `root-${index}`))
    expect(many.map((batch) => batch.length)).toEqual([50, 50, 20])
  })

  test("removes duplicate root IDs before splitting", () => {
    expect(summaryBatches(["a", "a", "b", "a"])).toEqual([["a", "b"]])
  })
})

describe("homeSummaryRequests", () => {
  test("groups by server and owner location and then batches each group", () => {
    const roots = [
      ...Array.from({ length: 51 }, (_, index) => scope("wsl", "/a", `root-${index}`)),
      scope("wsl", "/b", "other"),
      scope("ssh", "/a", "remote"),
    ]
    const requests = homeSummaryRequests(roots)
    expect(requests).toHaveLength(4)
    expect(requests.filter((request) => request.ownerDirectory === "/a" && request.serverKey === "wsl")).toHaveLength(2)
    expect(
      requests
        .filter((request) => request.serverKey === "wsl" && request.ownerDirectory === "/a")
        .map((request) => request.rootSessionIDs.length),
    ).toEqual([50, 1])
    expect(requests.find((request) => request.serverKey === "ssh")?.rootSessionIDs).toEqual(["remote"])
  })

  test("deduplicates repeated roots inside one location", () => {
    const requests = homeSummaryRequests([scope("wsl", "/a", "root"), scope("wsl", "/a", "root")])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.rootSessionIDs).toEqual(["root"])
  })
})

test("the loader fetches summaries per location and never loads a full run", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "root-a"), scope("wsl", "/b", "root-b")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    expect(local.calls.map((call) => call.directory)).toEqual(["/a", "/b"])
    local.calls[0]?.resolve([summary({ rootSessionID: "root-a", runID: "run-a" })])
    local.calls[1]?.resolve([])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.summary.runID).toBe("run-a")
    expect(loader.entry(scope("wsl", "/b", "root-b"))).toBeUndefined()
    expect(local.fullRunFetches()).toBe(0)
  }))

test("the loader batches at most fifty roots in one call", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal(Array.from({ length: 120 }, (_, index) => scope("wsl", "/a", `root-${index}`)))
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    expect(local.calls.map((call) => call.rootSessionIDs.length)).toEqual([50, 50, 20])
  }))

test("a late response from the previous server is ignored", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey, setServerKey] = createSignal("wsl")
    const [roots, setRoots] = createSignal([scope("wsl", "/a", "root-a")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    setServerKey("ssh")
    setRoots([scope("ssh", "/a", "root-b")])
    loader.reconcile()
    await settle()
    expect(local.calls).toHaveLength(2)
    local.calls[1]?.resolve([summary({ rootSessionID: "root-b", runID: "run-b" })])
    await settle()
    expect(loader.entry(scope("ssh", "/a", "root-b"))?.summary.runID).toBe("run-b")
    local.calls[0]?.resolve([summary({ rootSessionID: "root-a", runID: "run-a" })])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))).toBeUndefined()
    expect(loader.entry(scope("ssh", "/a", "root-b"))?.summary.runID).toBe("run-b")
  }))

test("the preferred summary keeps the active run over a newer cancelled run", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "root-a")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    local.calls[0]?.resolve([
      summary({ rootSessionID: "root-a", runID: "run-cancelled", status: "cancelled", updatedAt: 90 }),
      summary({ rootSessionID: "root-a", runID: "run-active", updatedAt: 10 }),
    ])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.summary.runID).toBe("run-active")
  }))

test("identical root IDs in different locations never share a summary", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "shared"), scope("wsl", "/b", "shared")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    expect(local.calls.map((call) => call.directory)).toEqual(["/a", "/b"])
    local.calls[0]?.resolve([summary({ rootSessionID: "shared", runID: "run-a" })])
    local.calls[1]?.resolve([summary({ rootSessionID: "shared", runID: "run-b" })])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "shared"))?.summary.runID).toBe("run-a")
    expect(loader.entry(scope("wsl", "/b", "shared"))?.summary.runID).toBe("run-b")
  }))

test("changing the selected server excludes the previous server's summaries immediately", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey, setServerKey] = createSignal("wsl")
    const [roots, setRoots] = createSignal([scope("wsl", "/a", "shared")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    local.calls[0]?.resolve([summary({ rootSessionID: "shared", runID: "run-a" })])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "shared"))?.summary.runID).toBe("run-a")
    setServerKey("ssh")
    setRoots([scope("ssh", "/a", "shared")])
    loader.reconcile()
    await settle()
    expect(loader.entry(scope("wsl", "/a", "shared"))).toBeUndefined()
    expect(loader.entry(scope("ssh", "/a", "shared"))).toBeUndefined()
    expect(local.calls).toHaveLength(2)
  }))

test("an invalidation must match one scope's location and root together", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "root-a"), scope("wsl", "/b", "root-b")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    local.calls[0]?.resolve([])
    local.calls[1]?.resolve([])
    await settle()
    events.emit({ rootSessionID: "root-a", runID: "run-a", revision: 2 }, "/b")
    events.emit({ rootSessionID: "root-b", runID: "run-b", revision: 2 }, "/a")
    await settle()
    expect(local.calls).toHaveLength(2)
    events.emit({ rootSessionID: "root-a", runID: "run-a", revision: 2 }, "/a")
    await settle()
    expect(local.calls).toHaveLength(4)
  }))

test("an invalidation for another location or root is ignored", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "root-a")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    local.calls[0]?.resolve([])
    await settle()
    events.emit({ rootSessionID: "root-a", runID: "run-a", revision: 2 }, "/elsewhere")
    events.emit({ rootSessionID: "root-other", runID: "run-other", revision: 2 }, "/a")
    events.emit({ rootSessionID: "root-a", runID: "run-a", revision: 2 }, undefined)
    await settle()
    expect(local.calls).toHaveLength(1)
  }))

test("only the failed scope is marked stale", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "root-a"), scope("wsl", "/b", "root-b")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    local.calls[0]?.resolve([summary({ rootSessionID: "root-a", runID: "run-a" })])
    local.calls[1]?.resolve([summary({ rootSessionID: "root-b", runID: "run-b" })])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.stale).toBe(false)
    expect(loader.entry(scope("wsl", "/b", "root-b"))?.stale).toBe(false)
    local.failFor("/b")
    events.emit({ rootSessionID: "root-a", runID: "run-a", revision: 2 }, "/a")
    await settle()
    local.calls[2]?.resolve([summary({ rootSessionID: "root-a", runID: "run-a", verified: 1, total: 2 })])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.stale).toBe(false)
    expect(loader.entry(scope("wsl", "/b", "root-b"))?.summary.runID).toBe("run-b")
    expect(loader.entry(scope("wsl", "/b", "root-b"))?.stale).toBe(true)
  }))

test("a failed refetch keeps the previous summary and marks it stale", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "root-a")])
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection: () => true,
    })
    loader.reconcile()
    await settle()
    local.calls[0]?.resolve([summary({ rootSessionID: "root-a", runID: "run-a" })])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.stale).toBe(false)
    local.failFor("/a")
    events.emit({ rootSessionID: "root-a", runID: "run-a", revision: 2 }, "/a")
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.summary.runID).toBe("run-a")
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.stale).toBe(true)
  }))

test("no roots and no connection make no requests", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots, setRoots] = createSignal<ExecutionScope[]>([])
    const [connection, setConnection] = createSignal(true)
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection,
    })
    loader.reconcile()
    await settle()
    expect(local.calls).toHaveLength(0)
    setRoots([scope("wsl", "/a", "root-a")])
    setConnection(false)
    loader.reconcile()
    await settle()
    expect(local.calls).toHaveLength(0)
    setConnection(true)
    loader.reconcile()
    await settle()
    expect(local.calls).toHaveLength(1)
  }))

test("the execution overview handoff is consumed exactly once", () => {
  expect(consumeExecutionOverview("root-handoff")).toBe(false)
  requestExecutionOverview("root-handoff")
  expect(consumeExecutionOverview("root-handoff")).toBe(true)
  expect(consumeExecutionOverview("root-handoff")).toBe(false)
  expect(consumeExecutionOverview(undefined)).toBe(false)
})

test("losing the connection keeps loaded summaries and marks them stale", () =>
  run(async () => {
    const local = fakeApi()
    const events = localEvents()
    const [serverKey] = createSignal("wsl")
    const [roots] = createSignal([scope("wsl", "/a", "root-a")])
    const [connection, setConnection] = createSignal(true)
    const loader = createHomeExecutionSummaries({
      serverKey,
      roots,
      api: () => local.api,
      events: () => events.source,
      connection,
    })
    loader.reconcile()
    await settle()
    local.calls[0]?.resolve([summary({ rootSessionID: "root-a", runID: "run-a" })])
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.stale).toBe(false)
    setConnection(false)
    loader.reconcile()
    await settle()
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.summary.runID).toBe("run-a")
    expect(loader.entry(scope("wsl", "/a", "root-a"))?.stale).toBe(true)
  }))
