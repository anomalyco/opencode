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

  test.each(["-0.35", "NaN", "Infinity"])("rejects a non-serializable direct cost of %s", (amount) => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].directCost.amount = amount

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("serializes a finite direct cost as a decimal string", () => {
    expect(Subagent.serializeDirectCost(1.2, "USD")).toEqual({ amount: "1.2", currency: "USD" })
  })
  ;[-0.35, Number.NaN, Number.POSITIVE_INFINITY].forEach((amount) => {
    test(`rejects an unrepresentable direct cost of ${amount}`, () => {
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
      list: (params?: { roots?: boolean }) =>
        Promise.resolve({ data: params?.roots ? input.sessions.filter((item) => !item.parentID) : input.sessions }),
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
