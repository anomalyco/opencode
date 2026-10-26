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

test("evicting an in-flight read leaves the next sync invalidated", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let requests = 0
  const setup = fixture(async () => {
    if (++requests !== 1) return
    requested.resolve()
    await release.promise
  })
  try {
    const initial = setup.data.session.message.sync("ses_child")
    await requested.promise
    setup.data.session.evict("ses_parent")
    release.resolve()
    await initial
    await setup.data.session.message.sync("ses_child")
    expect(requests).toBe(2)
    expect(setup.data.session.message.list("ses_child")).toHaveLength(1)
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

test("ignores step.started and subsequent streaming events for unloaded sessions", () => {
  const setup = fixture()
  try {
    setup.emit({
      id: "evt_step",
      created: 1,
      type: "session.step.started",
      durable: { aggregateID: "ses_other", seq: 1, version: 1 },
      data: {
        sessionID: "ses_other",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { providerID: "openai", id: "gpt-5" },
        started: 1,
      },
    })
    setup.emit({
      id: "evt_text_start",
      created: 2,
      type: "session.text.started",
      durable: { aggregateID: "ses_other", seq: 2, version: 1 },
      data: { sessionID: "ses_other", assistantMessageID: "msg_assistant", ordinal: 0 },
    })
    setup.emit({
      id: "evt_text_delta",
      created: 3,
      type: "session.text.delta",
      data: { sessionID: "ses_other", assistantMessageID: "msg_assistant", ordinal: 0, delta: "leaked" },
    })
    expect(setup.data.session.message.list("ses_other")).toEqual([])
    expect(setup.data.session.message.get("ses_other", "msg_assistant")).toBeUndefined()
  } finally {
    setup.dispose()
  }
})

test("subscribes before loading messages, splices buffered events by sequence, and marks closed sessions stale", async () => {
  const steps: string[] = []
  const subscribed = new Set<string>()
  const releaseSubscribe = Promise.withResolvers<void>()
  const releasePage = Promise.withResolvers<void>()
  let pageReads = 0

  const setup = fixture(
    async (url) => {
      if (!url.pathname.endsWith("/message")) return undefined
      pageReads += 1
      steps.push(`fetch:${pageReads}`)
      if (pageReads === 1) {
        await releasePage.promise
        return Response.json({
          data: [
            { id: "msg_10", type: "synthetic", text: "already in page", time: { created: 10 } },
            { id: "msg_page", type: "user", text: "page", time: { created: 0 } },
          ],
          cursor: {},
          seq: 10,
        })
      }
      return Response.json({
        data: [
          { id: "msg_20", type: "synthetic", text: "reopened page", time: { created: 20 } },
          { id: "msg_11", type: "synthetic", text: "after page", time: { created: 11 } },
          { id: "msg_10", type: "synthetic", text: "already in page", time: { created: 10 } },
          { id: "msg_page", type: "user", text: "page", time: { created: 0 } },
        ],
        cursor: {},
        seq: 20,
      })
    },
    {
      status: () => "connected",
      detail: () => "subscribed",
      isSubscribed: (id) => subscribed.has(id),
      async setSessions(sessions) {
        subscribed.clear()
        for (const id of sessions) subscribed.add(id)
        steps.push(`set:${Array.from(subscribed).join(",")}`)
      },
      async subscribeSession(id) {
        steps.push(`subscribe:${id}`)
        subscribed.add(id)
        await releaseSubscribe.promise
      },
    },
  )

  try {
    const syncPromise = setup.data.session.message.sync("ses_parent")
    expect(steps).toEqual(["subscribe:ses_parent"])

    // Subscription finishes; page fetch begins.
    releaseSubscribe.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(steps).toEqual(["subscribe:ses_parent", "fetch:1"])

    // While the page fetch (snapshot at seq=10) is in flight:
    // 1. Durable event at seq=10 (already in page) arrives -> must not duplicate.
    // 2. Ephemeral delta arrives -> must be dropped so it cannot corrupt or precede the page.
    // 3. Durable event at seq=11 arrives -> must be spliced after the page.
    setup.emit({
      id: "evt_10",
      created: 10,
      type: "session.synthetic",
      durable: { aggregateID: "ses_parent", seq: 10, version: 1 },
      data: { sessionID: "ses_parent", text: "already in page" },
    })
    setup.emit({
      id: "evt_delta",
      created: 10,
      type: "session.text.delta",
      data: { sessionID: "ses_parent", assistantMessageID: "msg_page", ordinal: 0, delta: "stale delta" },
    })
    setup.emit({
      id: "evt_11",
      created: 11,
      type: "session.synthetic",
      durable: { aggregateID: "ses_parent", seq: 11, version: 1 },
      data: { sessionID: "ses_parent", text: "after page" },
    })

    releasePage.resolve()
    await syncPromise

    expect(setup.data.session.message.list("ses_parent").map((item) => item.id)).toEqual([
      "msg_page",
      "msg_10",
      "msg_11",
    ])

    // Closing the tab removes `ses_parent` from the subscription set; its cached transcript becomes stale.
    await setup.data.session.subscribe(["ses_other"])
    expect(steps).toContain("set:ses_other")

    // Any stray event while unsubscribed is ignored instead of mutating the stale transcript.
    setup.emit({
      id: "evt_stray",
      created: 15,
      type: "session.synthetic",
      durable: { aggregateID: "ses_parent", seq: 15, version: 1 },
      data: { sessionID: "ses_parent", text: "while closed" },
    })
    expect(setup.data.session.message.list("ses_parent").map((item) => item.id)).toEqual([
      "msg_page",
      "msg_10",
      "msg_11",
    ])

    // Reopening `ses_parent` refetches a fresh page instead of treating the stale cache as current.
    await setup.data.session.message.sync("ses_parent")
    expect(pageReads).toBe(2)
    expect(setup.data.session.message.list("ses_parent").map((item) => item.id)).toEqual([
      "msg_page",
      "msg_10",
      "msg_11",
      "msg_20",
    ])
  } finally {
    releaseSubscribe.resolve()
    releasePage.resolve()
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

function fixture(
  read?: (url: URL) => Promise<Response | void>,
  connection?: CreateDataInput["connection"],
) {
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
              time: { created: 1 },
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
      connection,
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
