import { describe, expect, test } from "bun:test"
import type { Event, OpencodeClient, Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { ACPEvent } from "@/acp/event"
import { ACPSession } from "@/acp/session"
import { Subagent } from "@/acp/subagent"

const fixture = await Bun.file(`${import.meta.dir}/fixtures/subagents-v1.json`).json()

describe("acp subagent wire contract", () => {
  test("decodes and encodes the version-1 fixture", () => {
    expect(Subagent.decodeSnapshot(fixture.snapshot)).toEqual(fixture.snapshot)
    expect(Subagent.encodeSnapshot(fixture.snapshot)).toEqual(fixture.snapshot)
    expect(Subagent.decodeUpdate(fixture.update)).toEqual(fixture.update)
    expect(Subagent.encodeUpdate(fixture.update)).toEqual(fixture.update)
  })

  test("rejects an unsupported node phase", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].phase = "waiting"

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("rejects a node without its workspace directory", () => {
    const snapshot = structuredClone(fixture.snapshot)
    delete snapshot.nodes[1].cwd

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test.each([
    "-0.35",
    "-0",
    "NaN",
    "Infinity",
    "9".repeat(39),
    "9".repeat(40),
    "0".repeat(257),
    "1e128",
    "1.2e-128",
    "1e-129",
    "0e128",
    "0e-129",
    "1e9007199254740992",
  ])("rejects an out-of-contract direct cost of %s from snapshots and updates", (amount) => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].directCost.amount = amount
    const update = structuredClone(fixture.update)
    update.upsert = [structuredClone(snapshot.nodes[1])]
    update.removedSessionIds = []

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
    expect(() => Subagent.decodeUpdate(update)).toThrow()
  })

  test.each([
    "12345678901234567890123456789012345678",
    "1e127",
    "1e-128",
    "1.20",
    "+1.20",
    "12e-1",
    "000001.2000",
    "10e-129",
    "0",
    "0".repeat(256),
    "0e127",
    "0e-128",
  ])("accepts an exactly representable direct cost of %s in snapshots and updates", (amount) => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].directCost.amount = amount
    const update = structuredClone(fixture.update)
    update.upsert = [structuredClone(snapshot.nodes[1])]
    update.removedSessionIds = []

    expect(Subagent.decodeSnapshot(snapshot).nodes[1]?.directCost?.amount).toBe(amount)
    expect(Subagent.decodeUpdate(update).upsert[0]?.directCost?.amount).toBe(amount)
  })

  test.each(["", " ", "\t\n"])("rejects a blank direct cost currency from every public codec", (currency) => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].directCost.currency = currency
    const update = structuredClone(fixture.update)
    update.upsert = [structuredClone(snapshot.nodes[1])]
    update.removedSessionIds = []

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
    expect(() => Subagent.decodeUpdate(update)).toThrow()
    expect(() => Subagent.serializeDirectCost(1.2, currency)).toThrow()
  })

  test("rejects a non-string direct cost currency as a schema error", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].directCost.currency = 123
    const update = structuredClone(fixture.update)
    update.upsert = [structuredClone(snapshot.nodes[1])]
    update.removedSessionIds = []

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
    expect(() => Subagent.decodeUpdate(update)).toThrow()
  })
  ;[
    { amount: 0, expected: "0" },
    { amount: 1.2, expected: "1.2" },
    { amount: 1e127, expected: "1e+127" },
    { amount: 1e-128, expected: "1e-128" },
  ].forEach(({ amount, expected }) => {
    test(`serializes the finite direct cost ${amount} as ${expected}`, () => {
      expect(Subagent.serializeDirectCost(amount, "USD")).toEqual({ amount: expected, currency: "USD" })
    })
  })
  ;[
    { label: "negative zero", amount: -0 },
    { label: "-0.35", amount: -0.35 },
    { label: "NaN", amount: Number.NaN },
    { label: "positive infinity", amount: Number.POSITIVE_INFINITY },
    { label: "1e+128", amount: 1e128 },
    { label: "1.2e-128", amount: 1.2e-128 },
    { label: "Number.MAX_VALUE (1.7976931348623157e+308)", amount: Number.MAX_VALUE },
    { label: "Number.MIN_VALUE (5e-324)", amount: Number.MIN_VALUE },
  ].forEach(({ label, amount }) => {
    test(`rejects an unrepresentable direct cost of ${label}`, () => {
      expect(() => Subagent.serializeDirectCost(amount, "USD")).toThrow()
    })
  })

  test("rejects a cross-root parent", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].rootSessionId = "other-root"

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("rejects duplicate session identities", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].sessionId = "root"

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("accepts an empty collection of root graphs", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes = []

    expect(Subagent.decodeSnapshot(snapshot)).toEqual(snapshot)
  })

  test("accepts multiple valid root graphs", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes.push({
      runId: "other-root",
      sessionId: "other-root",
      rootSessionId: "other-root",
      phase: "completed",
      cwd: "/workspace/other-repo",
    })

    expect(Subagent.decodeSnapshot(snapshot)).toEqual(snapshot)
  })

  test("rejects a root group without its canonical root", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes = [
      {
        runId: "root-alias",
        sessionId: "root-alias",
        rootSessionId: "root",
        phase: "completed",
        cwd: "/workspace/repo",
      },
    ]

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("rejects a ninth descendant depth", () => {
    expect(() =>
      Subagent.decodeSnapshot({
        generation: "generation-a",
        revision: 0,
        nodes: Array.from({ length: 10 }, (_, depth) => ({
          runId: `node-${depth}`,
          sessionId: `node-${depth}`,
          rootSessionId: "node-0",
          ...(depth > 0 ? { parentSessionId: `node-${depth - 1}` } : {}),
          phase: "completed",
          cwd: "/workspace/repo",
        })),
      }),
    ).toThrow()
  })

  test("rejects a root with 301 descendants", () => {
    expect(() =>
      Subagent.decodeSnapshot({
        generation: "generation-a",
        revision: 0,
        nodes: [
          {
            runId: "root",
            sessionId: "root",
            rootSessionId: "root",
            phase: "running",
            cwd: "/workspace/repo",
          },
          ...Array.from({ length: 301 }, (_, index) => ({
            runId: `child-${index}`,
            sessionId: `child-${index}`,
            rootSessionId: "root",
            parentSessionId: "root",
            phase: "completed",
            cwd: "/workspace/repo",
          })),
        ],
      }),
    ).toThrow()
  })
})

describe("acp subagent snapshots", () => {
  test("reads every root graph with direct costs and authoritative phases", async () => {
    const fixture = recursiveSDK()
    const service = Subagent.make({ sdk: fixture.sdk })
    await service.handle(sessionError("child-completed"))

    const snapshot = await service.list({})

    expect(snapshot.nodes.map((node) => node.sessionId)).toEqual([
      "root-a",
      "child-running",
      "grandchild-completed",
      "child-completed",
      "root-b",
    ])
    expect(snapshot.nodes.map((node) => node.runId)).toEqual([
      "root-a",
      "child-running",
      "grandchild-completed",
      "child-completed",
      "root-b",
    ])
    expect(snapshot.nodes.map((node) => [node.sessionId, node.rootSessionId, node.parentSessionId])).toEqual([
      ["root-a", "root-a", undefined],
      ["child-running", "root-a", "root-a"],
      ["grandchild-completed", "root-a", "child-running"],
      ["child-completed", "root-a", "root-a"],
      ["root-b", "root-b", undefined],
    ])
    expect(snapshot.nodes.map((node) => [node.sessionId, node.cwd])).toEqual([
      ["root-a", "/workspace/root-a"],
      ["child-running", "/workspace/child-running"],
      ["grandchild-completed", "/workspace/grandchild-completed"],
      ["child-completed", "/workspace/child-completed"],
      ["root-b", "/workspace/root-b"],
    ])
    expect(snapshot.nodes.map((node) => [node.sessionId, node.phase])).toEqual([
      ["root-a", "running"],
      ["child-running", "running"],
      ["grandchild-completed", "completed"],
      ["child-completed", "failed"],
      ["root-b", "completed"],
    ])
    expect(snapshot.nodes.find((node) => node.sessionId === "root-a")?.directCost).toEqual({
      amount: "1.2",
      currency: "USD",
    })
    expect(snapshot.nodes.find((node) => node.sessionId === "child-running")?.directCost).toEqual({
      amount: "0.35",
      currency: "USD",
    })
    expect(fixture.statusReads).toBe(1)
  })

  test("filters snapshots to the requested root graph", async () => {
    const service = Subagent.make({ sdk: recursiveSDK().sdk })

    const snapshot = await service.list({ rootSessionId: "root-a" })

    expect(snapshot.nodes.map((node) => node.sessionId)).toEqual([
      "root-a",
      "child-running",
      "grandchild-completed",
      "child-completed",
    ])
  })

  test("rejects a ninth descendant while reading the SDK graph", async () => {
    const service = Subagent.make({ sdk: chainSDK(9) })

    await expect(service.list({})).rejects.toThrow("subagent depth must not exceed 8")
  })

  test("rejects a root with 301 descendants while reading the SDK graph", async () => {
    const service = Subagent.make({ sdk: descendantSDK(301) })

    await expect(service.list({})).rejects.toThrow("subagent descendants must not exceed 300")
  })

  test.each([
    { label: "negative", cost: -0.35 },
    { label: "nonfinite", cost: Number.POSITIVE_INFINITY },
    { label: "out-of-contract", cost: 1e128 },
  ])("retains list and subscription graphs while omitting a child with $label cost", async ({ cost }) => {
    const root = session({ id: "root", directory: "/workspace/root", cost: 1.2, created: 1, updated: 3 })
    const child = session({
      id: "child",
      parentID: "root",
      directory: "/workspace/child",
      cost,
      created: 2,
      updated: 2,
    })
    const grandchild = session({
      id: "grandchild",
      parentID: "child",
      directory: "/workspace/grandchild",
      cost: 0.1,
      created: 3,
      updated: 1,
    })
    const harness = await subscriptionHarness({
      sessions: [root, child, grandchild],
      status: { root: { type: "busy" }, child: { type: "idle" }, grandchild: { type: "idle" } },
    })
    const service = Subagent.make({ sdk: harness.sdk, events: harness.events, notify: () => Promise.resolve() })

    const listed = await service.list({})
    const subscribed = await service.subscribe({})

    for (const snapshot of [listed, subscribed]) {
      expect(snapshot.nodes.map((node) => node.sessionId)).toEqual(["root", "child", "grandchild"])
      expect(snapshot.nodes.map((node) => node.directCost)).toEqual([
        { amount: "1.2", currency: "USD" },
        undefined,
        { amount: "0.1", currency: "USD" },
      ])
    }

    service.close()
    harness.close()
  })
})

describe("acp subagent subscriptions", () => {
  test("registers before snapshot reads and reconciles an event omitted by the in-flight snapshot", async () => {
    const root = session({ id: "root", directory: "/workspace/root", created: 1, updated: 1 })
    const child = session({
      id: "child",
      parentID: "root",
      directory: "/workspace/child",
      created: 2,
      updated: 2,
    })
    const childrenStarted = Promise.withResolvers<void>()
    const releaseChildren = Promise.withResolvers<void>()
    const harness = await subscriptionHarness({
      sessions: [root],
      status: { root: { type: "busy" } },
      blockChildren: { rootSessionId: "root", started: childrenStarted, release: releaseChildren.promise },
    })
    const updates: Subagent.Update[] = []
    const notified = Promise.withResolvers<void>()
    const order: string[] = []
    const service = Subagent.make({
      sdk: harness.sdk,
      events: harness.events,
      notify: async (update) => {
        updates.push(update)
        order.push("update")
        notified.resolve()
      },
    })

    const subscribing = service.subscribe({ rootSessionId: "root" })
    await childrenStarted.promise
    const dispatched = harness.afterNextEvent(() => releaseChildren.resolve())
    harness.push(sessionChanged("session.created", child))

    const snapshot = await subscribing
    order.push("snapshot")
    await dispatched
    await notified.promise

    expect(snapshot.nodes.map((node) => node.sessionId)).toEqual(["root"])
    expect(order).toEqual(["snapshot", "update"])
    expect(updates).toEqual([
      {
        generation: snapshot.generation,
        revision: snapshot.revision + 1,
        upsert: [
          {
            runId: "child",
            sessionId: "child",
            rootSessionId: "root",
            parentSessionId: "root",
            agent: "build",
            title: "child",
            phase: "unknown",
            createdAt: "1970-01-01T00:00:00.002Z",
            updatedAt: "1970-01-01T00:00:00.002Z",
            cwd: "/workspace/child",
          },
        ],
        removedSessionIds: [],
      },
    ])

    service.close()
    harness.close()
  })

  test("projects session changes as bounded successor updates for only the affected root", async () => {
    const root = session({ id: "root", directory: "/workspace/root", created: 1, updated: 1 })
    const child = session({
      id: "child",
      parentID: "root",
      directory: "/workspace/child",
      created: 2,
      updated: 2,
    })
    const other = session({ id: "other", directory: "/workspace/other", created: 3, updated: 3 })
    const harness = await subscriptionHarness({
      sessions: [root, child, other],
      status: { root: { type: "busy" }, child: { type: "idle" }, other: { type: "idle" } },
    })
    const updates: Subagent.Update[] = []
    const service = Subagent.make({
      sdk: harness.sdk,
      events: harness.events,
      notify: async (update) => {
        updates.push(update)
      },
    })
    const snapshot = await service.subscribe({})

    const updated = { ...child, title: "renamed child", time: { ...child.time, updated: 4 } }
    await harness.send(sessionChanged("session.updated", updated))

    await harness.send(sessionStatus("child", { type: "busy" }))

    await harness.send(sessionIdle("child"))

    await harness.send(sessionError("child"))

    await harness.send(sessionChanged("session.deleted", updated))

    expect(updates.map((update) => update.revision)).toEqual([1, 2, 3, 4, 5])
    expect(updates.every((update) => update.generation === snapshot.generation)).toBe(true)
    expect(updates.slice(0, 4).map((update) => update.upsert.map((node) => node.sessionId))).toEqual([
      ["child"],
      ["child"],
      ["child"],
      ["child"],
    ])
    expect(updates.slice(0, 4).map((update) => update.upsert[0]?.phase)).toEqual([
      "completed",
      "running",
      "completed",
      "failed",
    ])
    expect(updates[0]?.upsert[0]?.title).toBe("renamed child")
    expect(updates[4]).toEqual({
      generation: snapshot.generation,
      revision: 5,
      upsert: [],
      removedSessionIds: ["child"],
    })
    expect(updates.flatMap((update) => update.upsert).some((node) => node.sessionId === "other")).toBe(false)

    service.close()
    harness.close()
  })

  test("publishes a cross-root move atomically before later updates", async () => {
    const rootA = session({ id: "root-a", directory: "/workspace/root-a", created: 1, updated: 1 })
    const rootB = session({ id: "root-b", directory: "/workspace/root-b", created: 2, updated: 2 })
    const child = session({
      id: "child",
      parentID: "root-a",
      directory: "/workspace/child",
      created: 3,
      updated: 3,
    })
    const harness = await subscriptionHarness({
      sessions: [rootA, rootB, child],
      status: { "root-a": { type: "idle" }, "root-b": { type: "idle" }, child: { type: "idle" } },
    })
    const updates: Subagent.Update[] = []
    const service = Subagent.make({
      sdk: harness.sdk,
      events: harness.events,
      notify: async (update) => {
        updates.push(update)
      },
    })
    const snapshot = await service.subscribe({})
    const moved = {
      ...child,
      parentID: "root-b",
      title: "moved child",
      time: { ...child.time, updated: 4 },
    }

    await harness.send(sessionChanged("session.updated", moved))
    await harness.send(sessionStatus("child", { type: "busy" }))

    expect(updates.map((update) => update.revision)).toEqual([1, 2])
    expect(updates[0]).toEqual({
      generation: snapshot.generation,
      revision: 1,
      upsert: [
        {
          runId: "child",
          sessionId: "child",
          rootSessionId: "root-b",
          parentSessionId: "root-b",
          agent: "build",
          title: "moved child",
          phase: "completed",
          createdAt: "1970-01-01T00:00:00.003Z",
          updatedAt: "1970-01-01T00:00:00.004Z",
          cwd: "/workspace/child",
        },
      ],
      removedSessionIds: [],
    })
    expect(updates[1]?.upsert).toMatchObject([
      {
        sessionId: "child",
        rootSessionId: "root-b",
        parentSessionId: "root-b",
        phase: "running",
      },
    ])

    service.close()
    harness.close()
  })

  test("does not reuse a revision after notification failure", async () => {
    const root = session({ id: "root", directory: "/workspace/root", created: 1, updated: 1 })
    const harness = await subscriptionHarness({ sessions: [root], status: { root: { type: "idle" } } })
    const revisions: number[] = []
    const service = Subagent.make({
      sdk: harness.sdk,
      events: harness.events,
      notify: async (update) => {
        revisions.push(update.revision)
        if (update.revision === 1) throw new Error("notification failed")
      },
    })
    await service.subscribe({})

    await harness.send(sessionStatus("root", { type: "busy" }))
    await harness.send(sessionIdle("root"))

    expect(revisions).toEqual([1, 2])

    service.close()
    harness.close()
  })

  test("unregisters on close and prevents later notifications", async () => {
    const root = session({ id: "root", directory: "/workspace/root", created: 1, updated: 1 })
    const harness = await subscriptionHarness({ sessions: [root], status: { root: { type: "idle" } } })
    const updates: Subagent.Update[] = []
    const service = Subagent.make({
      sdk: harness.sdk,
      events: harness.events,
      notify: async (update) => {
        updates.push(update)
      },
    })
    await service.subscribe({})
    service.close()

    await harness.send(sessionStatus("root", { type: "busy" }))

    expect(updates).toEqual([])

    harness.close()
  })

  test("rolls back a failed snapshot before a clean subscription retry", async () => {
    const root = session({ id: "root", directory: "/workspace/root", created: 1, updated: 1 })
    const attemptChild = session({
      id: "attempt-child",
      parentID: "root",
      directory: "/workspace/attempt-child",
      created: 2,
      updated: 2,
    })
    const detached = session({ id: "detached", directory: "/workspace/detached", created: 3, updated: 3 })
    const listStarted = Promise.withResolvers<void>()
    const rejectList = Promise.withResolvers<void>()
    let listReads = 0
    const harness = await subscriptionHarness({
      sessions: [root],
      status: { root: { type: "idle" } },
      list: async (roots) => {
        listReads += 1
        if (listReads !== 1) return roots
        listStarted.resolve()
        await rejectList.promise
        throw new Error("snapshot failed")
      },
    })
    const updates: Subagent.Update[] = []
    const service = Subagent.make({
      sdk: harness.sdk,
      events: harness.events,
      notify: async (update) => {
        updates.push(update)
      },
    })

    const first = service.subscribe({})
    await listStarted.promise
    const attemptDispatched = harness.afterNextEvent(() => rejectList.resolve())
    harness.push(sessionChanged("session.created", attemptChild))
    await attemptDispatched
    await expect(first).rejects.toThrow("snapshot failed")

    await harness.send(sessionChanged("session.created", detached))
    const snapshot = await service.subscribe({})
    await harness.send(sessionStatus("root", { type: "busy" }))

    expect(snapshot.nodes.map((node) => node.sessionId)).toEqual(["root"])
    expect(updates).toEqual([
      {
        generation: snapshot.generation,
        revision: 1,
        upsert: [
          {
            runId: "root",
            sessionId: "root",
            rootSessionId: "root",
            agent: "build",
            title: "root",
            phase: "running",
            createdAt: "1970-01-01T00:00:00.001Z",
            updatedAt: "1970-01-01T00:00:00.001Z",
            cwd: "/workspace/root",
          },
        ],
        removedSessionIds: [],
      },
    ])

    service.close()
    harness.close()
  })
})

function recursiveSDK() {
  const sessions = [
    session({ id: "root-a", directory: "/workspace/root-a", cost: 1.2, created: 1, updated: 10 }),
    session({
      id: "child-running",
      parentID: "root-a",
      directory: "/workspace/child-running",
      cost: 0.35,
      created: 2,
      updated: 9,
    }),
    session({
      id: "grandchild-completed",
      parentID: "child-running",
      directory: "/workspace/grandchild-completed",
      cost: 0.1,
      created: 3,
      updated: 8,
    }),
    session({
      id: "child-completed",
      parentID: "root-a",
      directory: "/workspace/child-completed",
      cost: 0.5,
      created: 4,
      updated: 7,
    }),
    session({ id: "root-b", directory: "/workspace/root-b", cost: 2, created: 5, updated: 6 }),
  ]
  const status: Record<string, SessionStatus> = {
    "root-a": { type: "busy" },
    "child-running": { type: "retry", attempt: 1, message: "retry", next: 11 },
    "grandchild-completed": { type: "idle" },
    "child-completed": { type: "busy" },
    "root-b": { type: "idle" },
  }
  let statusReads = 0

  return {
    sdk: sdk({ sessions, status, onStatus: () => statusReads++ }),
    get statusReads() {
      return statusReads
    },
  }
}

function chainSDK(descendantDepth: number) {
  const sessions = Array.from({ length: descendantDepth + 1 }, (_, index) =>
    session({
      id: `node-${index}`,
      ...(index > 0 ? { parentID: `node-${index - 1}` } : {}),
      directory: `/workspace/node-${index}`,
      created: index,
      updated: index,
    }),
  )
  return sdk({ sessions, status: Object.fromEntries(sessions.map((item) => [item.id, { type: "idle" }])) })
}

function descendantSDK(count: number) {
  const sessions = [
    session({ id: "root", directory: "/workspace/root", created: 0, updated: 0 }),
    ...Array.from({ length: count }, (_, index) =>
      session({
        id: `child-${index}`,
        parentID: "root",
        directory: `/workspace/child-${index}`,
        created: index + 1,
        updated: index + 1,
      }),
    ),
  ]
  return sdk({ sessions, status: Object.fromEntries(sessions.map((item) => [item.id, { type: "idle" }])) })
}

function sdk(input: { sessions: Session[]; status: Record<string, SessionStatus>; onStatus?: () => void }) {
  return {
    session: {
      list: (params?: { roots?: boolean }) =>
        Promise.resolve({ data: params?.roots ? input.sessions.filter((item) => !item.parentID) : input.sessions }),
      children: ({ sessionID }: { sessionID: string }) =>
        Promise.resolve({ data: input.sessions.filter((item) => item.parentID === sessionID) }),
      status: () => {
        input.onStatus?.()
        return Promise.resolve({ data: input.status })
      },
    },
  } as unknown as Pick<OpencodeClient, "session">
}

function session(input: {
  id: string
  directory: string
  created: number
  updated: number
  parentID?: string
  cost?: number
}): Session {
  return {
    id: input.id,
    slug: input.id,
    projectID: "project",
    directory: input.directory,
    ...(input.parentID ? { parentID: input.parentID } : {}),
    ...(input.cost === undefined ? {} : { cost: input.cost }),
    title: input.id,
    agent: "build",
    version: "1",
    time: { created: input.created, updated: input.updated },
  }
}

function sessionError(sessionID: string): Event {
  return {
    id: `event-${sessionID}`,
    type: "session.error",
    properties: { sessionID },
  }
}

type EventEnvelope = { payload?: Event }

async function subscriptionHarness(input: {
  sessions: Session[]
  status: Record<string, SessionStatus>
  blockChildren?: { rootSessionId: string; started: PromiseWithResolvers<void>; release: Promise<void> }
  list?: (roots: Session[]) => Promise<Session[]>
}) {
  const queue: EventEnvelope[] = []
  const waiters: Array<(value: EventEnvelope | undefined) => void> = []
  const streamReady = Promise.withResolvers<void>()
  let closed = false
  let childrenBlocked = false

  const stream = async function* (signal?: AbortSignal) {
    streamReady.resolve()
    while (!closed && !signal?.aborted) {
      const queued = queue.shift()
      if (queued) {
        yield queued
        continue
      }
      const next = await new Promise<EventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        signal?.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!next) return
      yield next
    }
  }
  const sdk = {
    global: {
      event: (options?: { signal?: AbortSignal }) => Promise.resolve({ stream: stream(options?.signal) }),
    },
    session: {
      list: async (params?: { roots?: boolean }) => {
        const sessions = params?.roots ? input.sessions.filter((item) => !item.parentID) : input.sessions
        return { data: input.list ? await input.list(sessions) : sessions }
      },
      children: async ({ sessionID }: { sessionID: string }) => {
        const data = input.sessions.filter((item) => item.parentID === sessionID)
        if (input.blockChildren && !childrenBlocked && sessionID === input.blockChildren.rootSessionId) {
          childrenBlocked = true
          input.blockChildren.started.resolve()
          await input.blockChildren.release
        }
        return { data }
      },
      status: () => Promise.resolve({ data: input.status }),
    },
  } as unknown as OpencodeClient
  const events = new ACPEvent.Subscription({
    sdk,
    connection: { sessionUpdate: () => Promise.resolve() },
    session: {
      tryGet: () => Effect.succeed(undefined),
    } as unknown as ACPSession.Interface,
  })
  events.start()
  await streamReady.promise

  const push = (event: Event) => {
    const envelope = { payload: event }
    const waiter = waiters.shift()
    if (waiter) {
      waiter(envelope)
      return
    }
    queue.push(envelope)
  }
  const afterNextEvent = (after?: () => void) => {
    const delivered = Promise.withResolvers<void>()
    const remove = events.addListener(async () => {
      after?.()
      remove()
      delivered.resolve()
    })
    return delivered.promise
  }

  return {
    sdk,
    events,
    push,
    afterNextEvent,
    send: (event: Event) => {
      const delivered = afterNextEvent()
      push(event)
      return delivered
    },
    close: () => {
      closed = true
      events.stop()
      waiters.splice(0).forEach((resolve) => resolve(undefined))
    },
  }
}

function sessionChanged(type: "session.created" | "session.updated" | "session.deleted", info: Session): Event {
  return {
    id: `event-${type}-${info.id}`,
    type,
    properties: { sessionID: info.id, info },
  }
}

function sessionStatus(sessionID: string, status: SessionStatus): Event {
  return {
    id: `event-status-${sessionID}`,
    type: "session.status",
    properties: { sessionID, status },
  }
}

function sessionIdle(sessionID: string): Event {
  return {
    id: `event-idle-${sessionID}`,
    type: "session.idle",
    properties: { sessionID },
  }
}
