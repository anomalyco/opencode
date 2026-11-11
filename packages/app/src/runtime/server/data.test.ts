import { afterEach, expect, setSystemTime, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "@opencode/client/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "@opencode/client/promise"
import { mergeRecentSessions } from "@/shell/titlebar/recent-sessions-model"
import { createDesktopData, createSessionMutations, createSessionRecency, createSessionRefresh } from "./data"
import { mergeRootSessionIndex } from "./session-index"

const session: SessionInfo = {
  id: "ses_test",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  location: { directory: "/project" },
}

type EventData = {
  [key: string]: string | number | boolean | null | EventData | readonly EventData[]
}

afterEach(() => setSystemTime())

function setupDesktop(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const handlers = new Map<string, Set<(event: OpenCodeEvent) => void>>()
  let seq = 0

  const setup = createRoot((dispose) => {
    const api = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(fetch, { preconnect: () => {} }),
    })

    const on: CreateDataInput["event"]["on"] = (type, handler) => {
      const set = handlers.get(type) ?? new Set()
      // SAFETY: this test emitter mirrors the SDK event API; handlers are invoked only for their own event type.
      const erased = handler as (event: OpenCodeEvent) => void
      set.add(erased)
      handlers.set(type, set)

      return () => set.delete(erased)
    }

    const events: CreateDataInput["event"] = {
      on,
      listen(handler) {
        listeners.add(handler)

        return () => listeners.delete(handler)
      },
    }

    const data = createDesktopData({
      data: createData({
        api: () => api,
        directory: "/project",
        connection: { status: () => "connected" },
        event: events,
      }),
      remove: async () => {},
    })

    return { data, dispose }
  })

  const emit = (type: OpenCodeEvent["type"], created: number, data: EventData = {}) => {
    seq++

    // SAFETY: the envelope matches the event's wire shape; `emit` is only called with the payload for `type`.
    const event = {
      id: `evt_${seq}`,
      type,
      created,
      durable: { aggregateID: session.id, seq, version: 1 },
      data: { sessionID: session.id, ...data },
    } as OpenCodeEvent

    listeners.forEach((listener) => listener({ name: type, details: event }))
    handlers.get(type)?.forEach((handler) => handler(event))
  }

  return {
    ...setup,
    emit,
    seed: (updated: number) => setup.data.session.remember({ ...session, time: { created: 0, updated } }),
  }
}

test("keeps a removed session hidden after its deletion event, for lists cached before it", async () => {
  const release = Promise.withResolvers<void>()
  const mutation = createSessionMutations(async () => release.promise)

  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  release.resolve()
  await request
  expect(mutation.apply([session])).toEqual([])

  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([])
})

test("hides a session another client deleted", () => {
  const mutation = createSessionMutations(async () => {})
  mutation.deleted(session.id)
  expect(mutation.apply([session])).toEqual([])
})

test("rolls back a failed removal", async () => {
  const release = Promise.withResolvers<void>()

  const mutation = createSessionMutations(async () => {
    await release.promise
    throw new Error("offline")
  })

  const request = mutation.remove(session.id)
  expect(mutation.apply([session])).toEqual([])
  release.resolve()
  await expect(request).rejects.toThrow("offline")
  expect(mutation.apply([session])).toEqual([session])
})

test("treats SessionNotFoundError on removal as already deleted", async () => {
  const mutation = createSessionMutations(async () => {
    throw JSON.parse('{"_tag":"SessionNotFoundError","sessionID":"ses_test","message":"Session not found: ses_test"}')
  })

  await expect(mutation.remove(session.id)).resolves.toBeUndefined()
  expect(mutation.apply([session])).toEqual([])
})

test("passive session events do not promote a session", () => {
  const setup = setupDesktop(async () => Response.json({ data: { ...session, time: { created: 0, updated: 10 } } }))

  try {
    setup.seed(10)
    setup.emit("session.inbox.enqueued", 51, {
      inboxID: "msg_input",
      item: { type: "user", payload: { text: "Hello" }, delivery: "steer" },
    })
    setup.emit("session.step.started", 52, {
      assistantMessageID: "msg_assistant",
      agent: "build",
      model: { providerID: "provider", id: "model" },
      started: 52,
    })
    setup.emit("session.step.ended", 53, {
      assistantMessageID: "msg_assistant",
      finish: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    setup.emit("session.step.failed", 54, { assistantMessageID: "msg_assistant", error: { type: "unknown" } })
    setup.emit("session.agent.selected", 55, { agent: "plan" })
    setup.emit("session.model.selected", 56, { model: { providerID: "provider", id: "model" } })
    setup.emit("session.metadata.updated", 57, { metadata: { source: "test" } })
    setup.emit("session.permissions", 58, { permissions: [] })
    setup.emit("session.moved", 59, { location: { directory: "/project" }, projectID: "project" })
    setup.emit("session.archived", 60)
    setup.emit("session.unarchived", 61)
    setup.emit("session.viewed", 62, { idle: 10 })

    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 10 } }])[0].time.updated).toBe(10)
    expect(setup.data.session.get(session.id)?.time.updated).toBe(10)
  } finally {
    setup.dispose()
  }
})

test("after a reload, Recent shows the order a restarted window shows for the same server data", () => {
  const other = { ...session, id: "ses_other", time: { created: 0, updated: 20 } }
  const running = setupDesktop(async () => Response.json({ data: session }))
  const restarted = setupDesktop(async () => Response.json({ data: session }))

  const order = (setup: typeof running, snapshot: SessionInfo[]) =>
    mergeRecentSessions("server", snapshot, setup.data.session.known(), (rows) =>
      setup.data.session.apply(rows, { reloads: true }),
    ).map((entry) => entry.session.id)

  try {
    // The running window renamed the session, which advanced its server time. It keeps its row until a reload.
    running.seed(10)
    running.emit("session.renamed", 30, { title: "Renamed" })
    expect(order(running, [other, { ...session, time: { created: 0, updated: 10 } }])).toEqual([
      "ses_other",
      session.id,
    ])

    const reloaded = [{ ...session, title: "Renamed", time: { created: 0, updated: 30 } }, other]
    restarted.seed(30)
    expect(order(running, reloaded)).toEqual([session.id, "ses_other"])
    expect(order(restarted, reloaded)).toEqual([session.id, "ses_other"])
  } finally {
    running.dispose()
    restarted.dispose()
  }
})

// The live record lags the server after a rename, model or agent change, step or metadata update, while list
// snapshots and events carry the newer time. A send must still bump past both until a newer record arrives.
test.each(["a rename event", "a reloaded list"] as const)(
  "a send after %s that is ahead of the live record still bumps until the server passes it",
  (source) => {
    const live = { ...session, time: { created: 0, updated: 10 } }
    const setup = setupDesktop(async () => Response.json({ data: live }))

    try {
      setup.seed(10)

      if (source === "a rename event") setup.emit("session.renamed", 50, { title: "Renamed" })
      else setup.data.session.apply([{ ...session, time: { created: 0, updated: 50 } }], { reloads: true })

      setSystemTime(new Date(1_000))
      setup.data.session.acceptSend(session.id)

      const at = (updated: number) =>
        setup.data.session.apply([{ ...session, time: { created: 0, updated } }], { reloads: true })[0].time.updated

      // A snapshot taken before the send, or one that only shows the earlier change, keeps the bump.
      expect(at(50)).toBe(1_000)
      expect(at(51)).toBe(51)
    } finally {
      setup.dispose()
    }
  },
)

test("a projected send bump merged through an index never becomes a server time", () => {
  const setup = setupDesktop(async () => Response.json({ data: session }))

  try {
    setup.seed(10)
    setSystemTime(new Date(1_000))
    setup.data.session.acceptSend(session.id)

    // A list rendered the projected row, then merged it with a fetched copy whose idle did not advance.
    const projected = setup.data.session.apply([{ ...session, time: { created: 0, updated: 10 } }])
    expect(projected[0].time.updated).toBe(1_000)

    const merged = mergeRootSessionIndex(projected, [
      { ...session, title: "Fetched", time: { created: 0, updated: 20 } },
    ])

    expect(setup.data.session.apply(merged)[0].time.updated).toBe(1_000)

    // The server caught up behind the local clock. A laundered 1,000 would have pinned the session there.
    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 150 } }])[0].time.updated).toBe(150)
  } finally {
    setup.dispose()
  }
})

test("an accepted send promotes immediately and survives a stale fetch until the server catches up", () => {
  const setup = setupDesktop(async () => Response.json({ data: session }))

  try {
    setup.seed(100)
    setSystemTime(new Date(1_000))
    setup.data.session.acceptSend(session.id)

    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 100 } }])[0].time.updated).toBe(1_000)
    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 90 } }])[0].time.updated).toBe(1_000)
    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 100 } }])[0].time.updated).toBe(1_000)

    // The server accepted the send, but its clock is behind ours. The send is no longer protected.
    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 150 } }])[0].time.updated).toBe(150)

    // A stale list fetch after the catch-up must not demote it again.
    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 100 } }])[0].time.updated).toBe(150)
  } finally {
    setup.dispose()
  }
})

test("send catch-up does not depend on the order records are applied", () => {
  const stale = { ...session, time: { created: 0, updated: 90 } }
  const fresh = { ...session, time: { created: 0, updated: 150 } }

  const batch = (records: SessionInfo[]) => {
    const recency = createSessionRecency()
    recency.acceptSend(session.id, { ...session, time: { created: 0, updated: 100 } }, 1_000)

    return recency.apply(records).map((item) => item.time.updated)
  }

  // The whole batch settles first, so a stale copy cannot briefly show the local bump beside a fresh copy.
  expect(batch([stale, fresh])).toEqual([150, 150])
  expect(batch([fresh, stale])).toEqual([150, 150])
  expect(batch([stale])).toEqual([1_000])

  const sequence = (records: SessionInfo[]) => {
    const recency = createSessionRecency()
    recency.acceptSend(session.id, { ...session, time: { created: 0, updated: 100 } }, 1_000)
    records.forEach((record) => recency.apply([record]))

    return recency.apply([stale])[0].time.updated
  }

  expect(sequence([stale, fresh])).toBe(150)
  expect(sequence([fresh, stale])).toBe(150)
})

test("remember restores the raw server time after apply projected a send bump", () => {
  const setup = setupDesktop(async () => Response.json({ data: session }))

  try {
    setup.seed(100)
    setSystemTime(new Date(1_000))
    setup.data.session.acceptSend(session.id)

    const bumped = setup.data.session.apply([{ ...session, time: { created: 0, updated: 100 } }])[0]
    expect(bumped.time.updated).toBe(1_000)
    setup.data.session.remember(bumped)

    expect(setup.data.session.get(session.id)?.time.updated).toBe(100)
    // A synthetic value must not have settled the pending send and raised its floor.
    expect(setup.data.session.apply([{ ...session, time: { created: 0, updated: 150 } }])[0].time.updated).toBe(150)
  } finally {
    setup.dispose()
  }
})

test("bounds per-session recency state", () => {
  const recency = createSessionRecency()

  for (let index = 0; index < 600; index++) recency.acceptSend(`ses_${index}`, undefined, 100_000 + index)

  expect(recency.apply([{ ...session, id: "ses_0", time: { created: 0, updated: 0 } }])[0].time.updated).toBe(0)
})

test("reading passively synced metadata leaves an accepted send pending for indexed lists", () => {
  const recency = createSessionRecency()
  const indexed = { ...session, time: { created: 0, updated: 10 } }
  recency.acceptSend(session.id, indexed, 1_000)
  expect(recency.project({ ...session, time: { created: 0, updated: 20 } }).time.updated).toBe(1_000)
  expect(recency.apply([indexed])[0].time.updated).toBe(1_000)
})

test("a shutdown interruption does not refresh the session", async () => {
  let gets = 0

  const setup = setupDesktop(async () => {
    gets++

    return Response.json({ data: session })
  })

  try {
    setup.seed(10)
    setup.emit("session.execution.interrupted", 50, { reason: "shutdown" })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(gets).toBe(0)
  } finally {
    setup.dispose()
  }
})

test.each(["loaded", "listed"] as const)("an execution end refreshes a %s root exactly once", async (source) => {
  let gets = 0
  const requested = Promise.withResolvers<void>()
  const refreshed = { ...session, time: { created: 0, updated: 50 } }

  const setup = setupDesktop(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())

    if (url.pathname === `/api/session/${session.id}`) {
      gets++
      requested.resolve()

      return Response.json({ data: refreshed })
    }

    return Response.json({ data: [] })
  })

  try {
    if (source === "loaded") setup.seed(10)
    else setup.data.session.apply([session])
    setup.emit("session.execution.succeeded", 50)
    await requested.promise
    await setup.data.session.sync(session.id)

    expect(gets).toBe(1)
    const info = setup.data.session.get(session.id)
    expect(info?.time.updated).toBe(50)
    expect(setup.data.session.apply(info ? [info] : [])[0]?.time.updated).toBe(50)
  } finally {
    setup.dispose()
  }
})

test.each(["child", "unknown", "self-reloading"] as const)(
  "an execution end skips an unloaded %s session",
  async (source) => {
    let gets = 0

    const setup = setupDesktop(async () => {
      gets++

      return Response.json({ data: session })
    })

    try {
      if (source === "child") setup.data.session.apply([{ ...session, parentID: "ses_parent" }])

      // Recent reloads its snapshot at run end, so its roots need no separate refresh.
      if (source === "self-reloading") setup.data.session.apply([session], { reloads: true })

      setup.emit("session.execution.succeeded", 50)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(gets).toBe(0)
      expect(setup.data.session.get(session.id)).toBeUndefined()
    } finally {
      setup.dispose()
    }
  },
)

test("coalesces overlapping refreshes for one session and keeps a queued one", async () => {
  const calls: string[] = []
  const gates = new Map<string, () => void>()

  const refresh = createSessionRefresh(
    (sessionID) =>
      new Promise<void>((resolve) => {
        calls.push(sessionID)
        gates.set(`${sessionID}:${calls.length}`, resolve)
      }),
  )

  const first = refresh("ses_a")
  refresh("ses_a")
  refresh("ses_a")
  expect(calls).toEqual(["ses_a"])

  gates.get("ses_a:1")?.()
  await first
  expect(calls).toEqual(["ses_a", "ses_a"])

  gates.get("ses_a:2")?.()
  await Promise.resolve()
  expect(calls).toEqual(["ses_a", "ses_a"])
})
