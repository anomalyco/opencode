import { afterEach, expect, setSystemTime, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "@opencode/client/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "@opencode/client/promise"
import { createDesktopData, createSessionMutations, createSessionRecency, createSessionRefresh } from "./data"

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

test("a rename does not promote the session, including when a refetch returns the rename time", () => {
  const setup = setupDesktop(async () => Response.json({ data: session }))

  try {
    setup.seed(10)
    setup.emit("session.renamed", 50, { title: "Renamed" })

    const renamed = { ...session, title: "Renamed", time: { created: 0, updated: 50 } }
    expect(setup.data.session.apply([renamed])[0].time.updated).toBe(10)

    // A later change promoted the session. A stale refetch at the rename time must not demote it.
    expect(setup.data.session.apply([{ ...renamed, time: { created: 0, updated: 60 } }])[0].time.updated).toBe(60)
    expect(setup.data.session.apply([renamed])[0].time.updated).toBe(60)
  } finally {
    setup.dispose()
  }
})

test("a rename with no live record waits for a stale copy before settling", () => {
  const stale = { ...session, time: { created: 0, updated: 10 } }
  const renamed = { ...session, title: "Renamed", time: { created: 0, updated: 50 } }

  const batch = (records: SessionInfo[]) => {
    const recency = createSessionRecency()
    recency.renamed(session.id, undefined, 50)

    return recency.apply(records).map((item) => item.time.updated)
  }

  // Whichever order the copies appear in, the stale copy supplies the pre-rename value.
  expect(batch([stale, renamed])).toEqual([10, 10])
  expect(batch([renamed, stale])).toEqual([10, 10])

  const sequence = (records: SessionInfo[]) => {
    const recency = createSessionRecency()
    recency.renamed(session.id, undefined, 50)

    return [...records, stale, renamed].map((record) => recency.apply([record])[0].time.updated)
  }

  // A renamed-only read has nothing to compare against. It uses the creation floor instead of promoting to `at`.
  const renamedFirst = sequence([renamed])
  expect(renamedFirst[0]).toBe(0)
  expect(renamedFirst.slice(1)).toEqual([10, 10])

  const staleFirst = sequence([stale])
  expect(staleFirst).toEqual([10, 10, 10])
})

test("a pre-rename record observed before the rename supplies the guard value", () => {
  const recency = createSessionRecency()
  recency.apply([{ ...session, time: { created: 0, updated: 10 } }])
  recency.renamed(session.id, undefined, 50)

  expect(recency.apply([{ ...session, time: { created: 0, updated: 50 } }])[0].time.updated).toBe(10)
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

test("a send after a rename is not demoted by a stale refetch at the rename time", () => {
  const setup = setupDesktop(async () => Response.json({ data: session }))

  try {
    setup.seed(10)
    setup.emit("session.renamed", 50, { title: "Renamed" })
    setSystemTime(new Date(1_000))
    setup.data.session.acceptSend(session.id)

    expect(
      setup.data.session.apply([{ ...session, title: "Renamed", time: { created: 0, updated: 50 } }])[0].time.updated,
    ).toBe(1_000)
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

test("an execution end refetches the session and applies the refreshed time", async () => {
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
    setup.seed(10)
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
