import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../src/promise"

test("evicts a whole family while preserving metadata and attention", async () => {
  const setup = fixture()
  try {
    for (const id of ["ses_parent", "ses_child", "ses_grandchild", "ses_other"]) {
      await setup.data.session.message.sync(id)
      await setup.data.session.pending.sync(id)
    }
    setup.data.session.setStatus("ses_child", "running")
    setup.emit({
      id: "evt_permission",
      created: 1,
      type: "permission.asked",
      data: { id: "per_test", sessionID: "ses_child", action: "bash", resources: ["bun test"] },
    })

    setup.data.session.evict("ses_parent")

    for (const id of ["ses_parent", "ses_child", "ses_grandchild"]) {
      expect(setup.data.session.message.list(id)).toEqual([])
      expect(setup.data.session.message.get(id, "msg_page")).toBeUndefined()
      expect(setup.data.session.message.more(id)).toBe(false)
      expect(setup.data.session.message.loading(id)).toBe(false)
      expect(setup.data.session.pending.list(id)).toEqual([])
      expect(setup.data.session.input.list(id)).toEqual([])
      expect(setup.data.session.get(id)?.id).toBe(id)
    }
    expect(setup.data.session.family("ses_parent")).toEqual(["ses_parent", "ses_child", "ses_grandchild"])
    expect(setup.data.session.status("ses_child")).toBe("running")
    expect(setup.data.session.permission.list("ses_child")?.[0]?.id).toBe("per_test")
    expect(setup.data.session.message.list("ses_other")).toHaveLength(2)

    setup.emit({
      id: "evt_agent",
      created: 1,
      type: "session.agent.selected",
      durable: { aggregateID: "ses_parent", seq: 1, version: 1 },
      data: { sessionID: "ses_parent", agent: "build" },
    })
    expect(setup.data.session.message.list("ses_parent")).toMatchObject([{ type: "agent-switched" }])
    await setup.data.session.message.sync("ses_parent")
    expect(setup.data.session.message.list("ses_parent").map((item) => item.id)).toEqual(["msg_page"])
    await setup.data.session.message.sync("ses_grandchild")
    await setup.data.session.pending.sync("ses_grandchild")
    expect(setup.data.session.message.list("ses_grandchild")).toHaveLength(2)
    expect(setup.data.session.message.list("ses_child")).toEqual([])
  } finally {
    setup.dispose()
  }
})

test("a transcript read in flight during eviction cannot repopulate the released session", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let requests = 0
  const setup = fixture(async (url) => {
    if (!url.pathname.endsWith("/message") || ++requests !== 1) return
    requested.resolve()
    await release.promise
  })
  try {
    const initial = setup.data.session.message.sync("ses_child")
    await requested.promise
    setup.data.session.evict("ses_parent")
    release.resolve()
    await initial
    expect(setup.data.session.message.list("ses_child")).toEqual([])
    expect(setup.data.session.message.more("ses_child")).toBe(false)
    await setup.data.session.message.sync("ses_child")
    expect(requests).toBe(2)
    expect(setup.data.session.message.list("ses_child")).toHaveLength(1)
    expect(setup.data.session.message.more("ses_child")).toBe(true)
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test("an inbox read in flight during eviction cannot repopulate the released session", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let requests = 0
  const setup = fixture(async (url) => {
    if (!url.pathname.endsWith("/inbox") || ++requests !== 1) return
    requested.resolve()
    await release.promise
  })
  try {
    const initial = setup.data.session.pending.sync("ses_child")
    await requested.promise
    setup.data.session.evict("ses_parent")
    release.resolve()
    await initial
    expect(setup.data.session.pending.list("ses_child")).toEqual([])
    expect(setup.data.session.input.list("ses_child")).toEqual([])
    expect(setup.data.session.message.list("ses_child")).toEqual([])
    await setup.data.session.pending.sync("ses_child")
    expect(requests).toBe(2)
    expect(setup.data.session.pending.list("ses_child")).toHaveLength(1)
    expect(setup.data.session.message.list("ses_child")).toHaveLength(1)
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test("an older page load in flight during eviction does not publish a partial transcript", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const setup = fixture(async (url) => {
    if (!url.searchParams.has("cursor")) return
    requested.resolve()
    await release.promise
  })
  try {
    await setup.data.session.message.sync("ses_child")
    expect(setup.data.session.message.more("ses_child")).toBe(true)
    const older = setup.data.session.message.loadMore("ses_child")
    await requested.promise
    setup.data.session.evict("ses_parent")
    release.resolve()
    await older
    expect(setup.data.session.message.list("ses_child")).toEqual([])
    expect(setup.data.session.message.more("ses_child")).toBe(false)
    expect(setup.data.session.message.loading("ses_child")).toBe(false)
    await setup.data.session.message.sync("ses_child")
    expect(setup.data.session.message.list("ses_child").map((item) => item.id)).toEqual(["msg_page"])
    expect(setup.data.session.message.more("ses_child")).toBe(true)
  } finally {
    release.resolve()
    setup.dispose()
  }
})

for (const collection of ["message", "pending"] as const) {
  test.each([false, true])(
    `queued ${collection} sync cannot survive close-reopen-close (reopen early: %s)`,
    async (early) => {
      const requested = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let requests = 0
      const setup = fixture(async (url) => {
        if (!url.pathname.endsWith(collection === "message" ? "/message" : "/inbox")) return
        if (++requests !== 1) return
        requested.resolve()
        await release.promise
      })
      try {
        const read = () => setup.data.session[collection].sync("ses_child")
        const initial = read()
        await requested.promise
        setup.data.session.evict("ses_parent")
        const obsolete = read()
        setup.data.session.evict("ses_parent")
        // A genuine reopen can itself queue behind the obsolete callback.
        const fresh = early ? read() : undefined
        release.resolve()
        await Promise.all([initial, obsolete])
        if (!early) {
          expect(setup.data.session.message.list("ses_child")).toEqual([])
          expect(setup.data.session.pending.list("ses_child")).toEqual([])
          expect(requests).toBe(1)
        }
        await (fresh ?? read())
        expect(requests).toBe(2)
        expect(setup.data.session[collection].list("ses_child")).toHaveLength(1)
        // Only the genuine reopen completes the cache entry.
        await read()
        expect(requests).toBe(2)
      } finally {
        release.resolve()
        setup.dispose()
      }
    },
  )
}

test.each([false, true])("queued older-page load cannot adopt a reopened session (all: %s)", async (all) => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let pages = 0
  const setup = fixture(async (url) => {
    if (!url.searchParams.has("cursor")) return
    if (++pages !== 1) return
    requested.resolve()
    await release.promise
  })
  try {
    await setup.data.session.message.sync("ses_child")
    const initial = setup.data.session.message.loadMore("ses_child")
    await requested.promise
    const obsolete = setup.data.session.message.loadMore("ses_child", { all })
    setup.data.session.evict("ses_parent")
    await setup.data.session.message.sync("ses_child")
    release.resolve()
    await Promise.all([initial, obsolete])
    expect(pages).toBe(1)
    expect(setup.data.session.message.more("ses_child")).toBe(true)
    expect(setup.data.session.message.loading("ses_child")).toBe(false)
    await setup.data.session.message.loadMore("ses_child", { all })
    expect(pages).toBe(2)
    expect(setup.data.session.message.more("ses_child")).toBe(false)
  } finally {
    release.resolve()
    setup.dispose()
  }
})

test.each(["echo", "reject"] as const)("eviction preserves optimistic submissions until %s", async (mode) => {
  const release = Promise.withResolvers<void>()
  const setup = fixture(async (url) => {
    if (!url.pathname.endsWith("/prompt")) return undefined
    await release.promise
    return mode === "reject"
      ? Response.json({ message: "rejected" }, { status: 400 })
      : Response.json({ id: "msg_local" })
  })
  try {
    const request = setup.data.session.prompt({ sessionID: "ses_child", id: "msg_local", text: "local" })
    const settled = Promise.allSettled([request])
    setup.data.session.evict("ses_parent")
    expect(setup.data.session.message.list("ses_child")).toMatchObject([{ id: "msg_local", text: "local" }])
    if (mode === "echo") setup.emit(enqueued("ses_child", "msg_local"))
    release.resolve()
    await settled
    expect(setup.data.session.message.list("ses_child")).toHaveLength(mode === "echo" ? 1 : 0)
    expect(setup.data.session.pending.list("ses_child")).toHaveLength(mode === "echo" ? 1 : 0)
  } finally {
    release.resolve()
    setup.dispose()
  }
})

function info(id: string, parentID?: string): SessionInfo {
  return {
    id,
    parentID,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/project" },
  }
}

function enqueued(sessionID: string, inboxID = "msg_pending"): OpenCodeEvent {
  return {
    id: `evt_${inboxID}`,
    created: 1,
    type: "session.inbox.enqueued",
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, inboxID, item: { type: "user", delivery: "steer", payload: { text: "pending" } } },
  }
}

function fixture(read?: (url: URL) => Promise<Response | void>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const response = await read?.(url)
      if (response) return response
      const sessionID = url.pathname.split("/")[3]
      if (url.pathname.endsWith("/inbox"))
        return Response.json({
          data: [
            {
              id: "msg_pending",
              sessionID,
              type: "user",
              delivery: "steer",
              payload: { text: "pending" },
              timeCreated: 1,
            },
          ],
        })
      return Response.json({
        data: [{ id: "msg_page", type: "user", text: "page", time: { created: 0 } }],
        cursor: url.searchParams.has("cursor") ? {} : { next: "older" },
      })
    },
  })
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    })
    data.session.remember(info("ses_parent"))
    data.session.remember(info("ses_child", "ses_parent"))
    data.session.remember(info("ses_grandchild", "ses_child"))
    data.session.remember(info("ses_other"))
    return {
      data,
      dispose,
      emit: (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
    }
  })
}
