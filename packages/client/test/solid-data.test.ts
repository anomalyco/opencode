import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../src/promise"

const session = (viewed: number): SessionInfo => ({
  id: "ses_refresh",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  outcome: "succeeded",
  time: { created: 0, updated: 0, idle: 2, viewed },
  location: { directory: "/project" },
})

test("revalidates after an event overtakes an active session read", async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  let requests = 0
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session/ses_refresh")) throw new Error(`Unexpected request: ${request.url}`)
      requests++
      if (requests === 1) {
        await gate
        return Response.json({ data: session(1) })
      }
      return Response.json({ data: session(2) })
    },
  })
  const event: CreateDataInput["event"] = {
    on:
      <Type extends OpenCodeEvent["type"]>(
        _type: Type,
        _handler: (event: Extract<OpenCodeEvent, { type: Type }>) => void,
      ) =>
      () => {},
    listen(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/project", event, connection: { status: () => "connected" } }),
    dispose,
  }))

  try {
    setup.data.session.remember(session(1))
    setup.data.session.invalidate("ses_refresh")
    const initial = setup.data.session.sync("ses_refresh")
    await wait(() => requests === 1)

    const viewed: OpenCodeEvent = {
      id: "evt_viewed",
      created: 2,
      type: "session.viewed",
      durable: { aggregateID: "ses_refresh", seq: 1, version: 1 },
      data: { sessionID: "ses_refresh", idle: 2 },
    }
    listeners.forEach((listener) => listener({ name: viewed.type, details: viewed }))
    await Bun.sleep(20)
    release()
    await initial

    await wait(() => requests === 2 && setup.data.session.get("ses_refresh")?.time.viewed === 2)
  } finally {
    setup.dispose()
  }
})

test("reports optimistic sessions as creating until the request settles", async () => {
  const release = Promise.withResolvers<void>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (!request.url.endsWith("/api/session")) throw new Error(`Unexpected request: ${request.url}`)
      await release.promise
      return Response.json({ data: session(0) })
    },
  })
  const event: CreateDataInput["event"] = {
    on: () => () => {},
    listen: () => () => {},
  }
  const setup = createRoot((dispose) => ({
    data: createData({ api: () => api, directory: "/project", event, connection: { status: () => "connected" } }),
    dispose,
  }))

  try {
    const created = setup.data.session.create({ id: "ses_refresh", location: { directory: "/project" } })
    expect(setup.data.session.creating(created.id)).toBe(true)
    release.resolve()
    await created.request
    expect(setup.data.session.creating(created.id)).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("loads bounded message pages", async () => {
  const requests: URL[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url)
      return Response.json({ data: [], cursor: requests.length === 1 ? { next: "next" } : {} })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: { on: () => () => {}, listen: () => () => {} },
    }),
    dispose,
  }))

  try {
    await setup.data.session.message.sync("ses_refresh")
    await setup.data.session.message.loadMore("ses_refresh")

    expect(requests).toHaveLength(2)
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ limit: "20", order: "desc" })
    expect(Object.fromEntries(requests[1].searchParams)).toEqual({ cursor: "next", limit: "20" })
  } finally {
    setup.dispose()
  }
})

test("preserves assistant content replacement events across an active message read", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const release = Promise.withResolvers<void>()
  let requests = 0
  const content = [
    { type: "text" as const, text: "replacement" },
    { type: "reasoning" as const, text: "reasoning", time: { created: 3 } },
  ]
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async () => {
      const current = ++requests
      if (current === 2) await release.promise
      return Response.json({
        data: [
          {
            id: "msg_assistant",
            type: "assistant",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: current === 3 ? content : [{ type: "text", text: "original" }],
            time: { created: 1, completed: 2 },
          },
        ],
        cursor: {},
      })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))

  try {
    await setup.data.session.message.sync("ses_refresh")
    setup.data.session.message.invalidate("ses_refresh")
    const stale = setup.data.session.message.sync("ses_refresh")
    await wait(() => requests === 2)
    const updated: OpenCodeEvent = {
      id: "evt_message_updated",
      created: 3,
      type: "session.message.content.updated",
      durable: { aggregateID: "ses_refresh", seq: 3, version: 1 },
      data: {
        sessionID: "ses_refresh",
        messageID: "msg_assistant",
        content,
      },
    }
    listeners.forEach((listener) => listener({ name: updated.type, details: updated }))

    expect(setup.data.session.message.list("ses_refresh")[0]).toMatchObject({ content })
    release.resolve()
    await stale
    await wait(() => requests === 3)
    expect(setup.data.session.message.list("ses_refresh")[0]).toMatchObject({ content })
  } finally {
    setup.dispose()
  }
})

async function wait(check: () => boolean) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for condition")
    await Bun.sleep(10)
  }
}
