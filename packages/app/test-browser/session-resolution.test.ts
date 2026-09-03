import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createData } from "@opencode-ai/client/solid"
import { OpenCode, type SessionInboxInfo, type SessionInfo, type SessionMessageInfo } from "@opencode-ai/client/promise"
import { createSessionResolution } from "@/session/session-resolution"

type Session = { id: string; directory: string }

const sessionOf = (id: string): Session => ({ id, directory: `/dir/${id}` })

// Fake session store: get reads a reactive cache, sync returns a
// deferred promise the test settles or fails explicitly. The session memo is
// live (read below), so it recomputes eagerly on cache/status writes — throws
// surface at the write site, which is also where the enclosing ErrorBoundary
// would see them in the app. Assertions wrap write + read to cover both.
function createFixture(initial: Record<string, Session> = {}) {
  const [cache, setCache] = createSignal(initial)
  const deferred = new Map<string, PromiseWithResolvers<unknown>>()
  const resolves: string[] = []
  const messages = { syncs: [] as string[], ...Promise.withResolvers<unknown>() }
  const pending = { syncs: [] as string[], items: [] as string[], ...Promise.withResolvers<unknown>() }
  return {
    resolves,
    messages,
    pending,
    sessions: {
      get: (id: string) => cache()[id],
      sync: (id: string) => {
        resolves.push(id)
        const entry = deferred.get(id) ?? Promise.withResolvers<unknown>()
        deferred.set(id, entry)
        return entry.promise
      },
      message: {
        sync: (id: string) => {
          messages.syncs.push(id)
          return messages.promise
        },
      },
      pending: {
        list: () => pending.items,
        sync: (id: string) => {
          pending.syncs.push(id)
          return pending.promise
        },
      },
    },
    settle(id: string, directory = `/dir/${id}`) {
      setCache({ ...cache(), [id]: { id, directory } })
      deferred.get(id)?.resolve(undefined)
      deferred.delete(id)
    },
    fail(id: string, error: unknown) {
      deferred.get(id)?.reject(error)
      // The real store does not cache failures: the inflight request entry is
      // dropped on rejection so the next resolve retries.
      deferred.delete(id)
    },
    remove(id: string) {
      const next = { ...cache() }
      delete next[id]
      setCache(next)
    },
  }
}

// Two microtask ticks: one for the resolve promise handed back by the fixture,
// one for the .then/.catch chain inside createSessionResolution.
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test("refreshes the current session on reconnect while keeping cached content visible", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: sessionOf("ses_a") })
    const [connection, setConnection] = createStore({ connected: false })
    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
      { connected: () => connection.connected },
    )

    expect(current()).toEqual(sessionOf("ses_a"))
    expect(fixture.resolves).toEqual([])
    expect(fixture.pending.syncs).toEqual([])
    await flush()
    setConnection("connected", true)
    expect(fixture.resolves).toEqual(["ses_a"])
    fixture.settle("ses_a")
    await flush()

    setConnection("connected", false)
    expect(current()).toEqual(sessionOf("ses_a"))
    expect(fixture.resolves).toEqual(["ses_a"])
    setConnection("connected", true)
    expect(fixture.resolves).toEqual(["ses_a", "ses_a"])
    expect(current()).toEqual(sessionOf("ses_a"))
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_a"])
    expect(fixture.pending.syncs).toEqual(["ses_a", "ses_a"])
    fixture.settle("ses_a", "/worktrees/moved")
    await flush()
    expect(current()?.directory).toBe("/worktrees/moved")
    dispose()
  })
})

test("starts metadata, messages, and an empty pending cache in parallel once the route has a session ID", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal<string>()
    const current = createSessionResolution(id, () => fixture.sessions)

    expect(current()).toBeUndefined()
    await flush()
    expect(fixture.resolves).toEqual([])
    expect(fixture.messages.syncs).toEqual([])
    expect(fixture.pending.syncs).toEqual([])

    setId("ses_a")
    expect(fixture.resolves).toEqual(["ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a"])
    expect(fixture.pending.syncs).toEqual(["ses_a"])

    fixture.messages.resolve(undefined)
    await flush()
    expect(current()).toBeUndefined()

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

test.each(["messages", "pending"] as const)("%s failure does not fail metadata resolution", async (read) => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
    )

    await flush()
    fixture[read].reject(new Error(`${read} sync failed`))
    await flush()
    expect(current()).toBeUndefined()

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

test.each(["resolve", "reject"] as const)(
  "refreshes cached pending membership before messages when its read does %s",
  async (outcome) => {
    await createRoot(async (dispose) => {
      const fixture = createFixture()
      fixture.pending.items.push("msg_queued")
      const current = createSessionResolution(
        () => "ses_a",
        () => fixture.sessions,
      )

      expect(fixture.pending.syncs).toEqual(["ses_a"])
      expect(fixture.messages.syncs).toEqual([])
      fixture.settle("ses_a")
      await flush()
      expect(current()?.id).toBe("ses_a")
      expect(fixture.messages.syncs).toEqual([])

      if (outcome === "resolve") fixture.pending.resolve(undefined)
      if (outcome === "reject") fixture.pending.reject(new Error("pending sync failed"))
      await flush()
      expect(fixture.messages.syncs).toEqual(["ses_a"])
      expect(current()?.id).toBe("ses_a")
      dispose()
    })
  },
)

test.each(["delivered", "cancelled"] as const)(
  "refreshes a prompt %s while disconnected without changing sessions",
  async (outcome) => {
    const session: SessionInfo = {
      id: "ses_reconnect",
      projectID: "project",
      location: { directory: "/project" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
    }
    const queued: SessionInboxInfo = {
      id: "msg_queued",
      sessionID: session.id,
      type: "user",
      delivery: "queue",
      payload: { text: "Queued follow-up" },
      timeCreated: 2,
    }
    const server = { inbox: [queued], messages: [] as SessionMessageInfo[] }
    const requests: string[] = []
    const api = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(new Request(input, init).url).pathname
          requests.push(path)
          if (path === `/api/session/${session.id}`) return Response.json({ data: session })
          if (path === `/api/session/${session.id}/inbox`) return Response.json({ data: server.inbox })
          if (path === `/api/session/${session.id}/message`) return Response.json({ data: server.messages, cursor: {} })
          throw new Error(`Unexpected request: ${path}`)
        },
        { preconnect() {} },
      ),
    })
    const root = createRoot((dispose) => {
      const [connection, setConnection] = createStore({ connected: true })
      const data = createData({
        api: () => api,
        directory: "/project",
        event: { on: () => () => {}, listen: () => () => {} },
        connection: { status: () => (connection.connected ? "connected" : "disconnected") },
      })
      const current = createSessionResolution(
        () => session.id,
        () => data.session,
        { connected: () => connection.connected },
      )
      return { dispose, data, current, setConnection }
    })

    try {
      // The timeline also hydrates pending on mount; the cache joins this read.
      await Promise.all([
        root.data.session.sync(session.id),
        root.data.session.message.sync(session.id),
        root.data.session.pending.sync(session.id),
      ])
      expect(root.current()?.id).toBe(session.id)
      expect(root.data.session.pending.list(session.id).map((item) => item.id)).toEqual([queued.id])
      expect(requests.filter((path) => path.endsWith("/inbox"))).toHaveLength(1)

      root.setConnection("connected", false)
      await flush()
      server.inbox = []
      server.messages =
        outcome === "delivered" ? [{ id: queued.id, type: "user", text: "Queued follow-up", time: { created: 3 } }] : []
      root.setConnection("connected", true)
      await root.data.session.sync(session.id)
      await flush()

      // Check that the reconnect path started the inbox request before joining it below.
      expect(requests.filter((path) => path.endsWith("/inbox"))).toHaveLength(2)
      await root.data.session.pending.sync(session.id)
      await root.data.session.message.sync(session.id)
      expect(root.current()?.id).toBe(session.id)
      expect(root.data.session.pending.list(session.id)).toHaveLength(0)
      expect(root.data.session.input.list(session.id)).toEqual([])
      expect(root.data.session.message.list(session.id).map((message) => message.id)).toEqual(
        outcome === "delivered" ? [queued.id] : [],
      )
      expect(requests.filter((path) => path.endsWith("/message"))).toHaveLength(2)
    } finally {
      root.dispose()
    }
  },
)

// Session tabs on the same server share one route instance, so navigating to
// another session changes the id in place; resolution must follow it instead
// of reporting the new session as missing.
test("re-resolves when navigating to an uncached session without a remount", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture({ ses_a: sessionOf("ses_a") })
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    expect(current()?.id).toBe("ses_a")
    expect(fixture.resolves).toEqual([])
    expect(fixture.messages.syncs).toEqual(["ses_a"])

    expect(() => {
      setId("ses_b")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_b"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b"])

    fixture.settle("ses_b")
    await flush()
    expect(current()?.id).toBe("ses_b")

    dispose()
  })
})

// A late failure from a session the user already navigated away from must not
// poison the currently viewed session.
test("ignores a stale resolution failure after the target changes", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("Session not found: ses_a"))
    await flush()

    expect(() => current()).not.toThrow()
    fixture.settle("ses_b")
    await flush()
    expect(current()?.id).toBe("ses_b")

    dispose()
  })
})

test("returning to a pruned session re-resolves instead of throwing not found", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    fixture.settle("ses_a")
    await flush()

    setId("ses_b")
    fixture.settle("ses_b")
    await flush()

    fixture.remove("ses_a")
    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

// A resolution that fails while its session is unfocused must not leave a
// poisoned status behind: revisiting that session retries cleanly instead of
// rethrowing the stale failure before the retry can start.
test("revisiting a session whose resolution failed while unfocused retries cleanly", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const [id, setId] = createSignal("ses_a")
    const current = createSessionResolution(id, () => fixture.sessions)

    await flush()
    setId("ses_b")
    fixture.fail("ses_a", new Error("resolve failed"))
    await flush()

    expect(() => {
      setId("ses_a")
      current()
    }).not.toThrow()
    expect(fixture.resolves).toEqual(["ses_a", "ses_b", "ses_a"])
    expect(fixture.messages.syncs).toEqual(["ses_a", "ses_b", "ses_a"])

    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

// The session accessor is reactive: replacing the data store (for example after
// the server context is rebuilt) must gate out the old store's status and
// re-resolve against the new one instead of fabricating a not-found.
test("re-resolves against a replaced session store", async () => {
  await createRoot(async (dispose) => {
    const first = createFixture()
    const second = createFixture()
    const [store, setStore] = createSignal(first.sessions)
    const current = createSessionResolution(() => "ses_a", store)

    await flush()
    first.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    expect(() => {
      setStore(second.sessions)
      current()
    }).not.toThrow()
    await flush()
    expect(second.resolves).toEqual(["ses_a"])
    expect(first.messages.syncs).toEqual(["ses_a"])
    expect(second.messages.syncs).toEqual(["ses_a"])

    second.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    dispose()
  })
})

// The viewed session is pinned in the cache, so disappearing after settlement
// means it was deleted; the boundary must show the not found fallback.
test("throws not found when the settled session is deleted", async () => {
  await createRoot(async (dispose) => {
    const fixture = createFixture()
    const current = createSessionResolution(
      () => "ses_a",
      () => fixture.sessions,
    )

    await flush()
    fixture.settle("ses_a")
    await flush()
    expect(current()?.id).toBe("ses_a")

    expect(() => {
      fixture.remove("ses_a")
      current()
    }).toThrow("Session not found: ses_a")

    dispose()
  })
})
