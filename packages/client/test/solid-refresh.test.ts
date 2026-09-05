import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../src/promise"

test("config reads and update refreshes are opt-in", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const location = { directory: "/project" }
  let model = "provider/first"
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      requests.push(url.pathname)
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/config") return Response.json([{ type: "document", info: { model } }])
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [], templates: [] } })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
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
  const event: OpenCodeEvent = { id: "evt_config", created: 1, type: "config.updated", location, data: {} }
  try {
    await setup.data.location.sync()
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    expect(requests).not.toContain("/api/config")

    await setup.data.location.config.sync()
    expect(requests.filter((path) => path === "/api/config")).toHaveLength(1)
    model = "provider/second"
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await setup.data.location.config.sync()
    expect(requests.filter((path) => path === "/api/config")).toHaveLength(2)
    expect(setup.data.location.config.list()).toEqual([{ type: "document", info: { model } }])
  } finally {
    setup.dispose()
  }
})

test("mcp catalog refreshes are opt-in to locations a consumer already read", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const opened = { directory: "/opened" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const location = { directory: url.searchParams.get("location[directory]") ?? opened.directory }
      requests.push(`${url.pathname}?${location.directory}`)
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [], templates: [] } })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: opened.directory,
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
  const emit = (directory: string) => {
    const location = { directory }
    const events: OpenCodeEvent[] = [
      { id: "evt_status", created: 1, type: "mcp.status.changed", location, data: { server: "test" } },
      { id: "evt_resources", created: 2, type: "mcp.resources.changed", location, data: { server: "test" } },
    ]
    events.forEach((event) => listeners.forEach((listener) => listener({ name: event.type, details: event })))
  }
  try {
    Array.from({ length: 300 }, (_, index) => emit(`/history/${index}`))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toEqual([])

    await Promise.all([setup.data.location.mcp.server.sync(opened), setup.data.location.mcp.resource.sync(opened)])
    expect(requests).toEqual([`/api/mcp?${opened.directory}`, `/api/mcp/resource?${opened.directory}`])
    emit(opened.directory)
    emit("/history/0")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toEqual([
      `/api/mcp?${opened.directory}`,
      `/api/mcp/resource?${opened.directory}`,
      `/api/mcp?${opened.directory}`,
      `/api/mcp/resource?${opened.directory}`,
    ])
    // An unread location stays invalidated, so the first explicit read still fetches.
    await setup.data.location.mcp.server.sync({ directory: "/history/0" })
    expect(requests.at(-1)).toBe("/api/mcp?/history/0")
  } finally {
    setup.dispose()
  }
})

test("websearch providers populate from events for opened locations only", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const opened = { directory: "/opened" }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const location = { directory: url.searchParams.get("location[directory]") ?? opened.directory }
      requests.push(`${url.pathname}?${location.directory}`)
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/websearch/provider")
        return Response.json({ location, data: [{ id: "exa", name: "Exa", status: "connected" }] })
      return Response.json({ location, data: [] })
    },
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: opened.directory,
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
  const emit = (directory: string) => {
    const event: OpenCodeEvent = {
      id: "evt_ws",
      created: 1,
      type: "websearch.updated",
      location: { directory },
      data: {},
    }
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
  }
  try {
    emit("/history")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toEqual([])

    // The TUI's integration dialog reads websearch without ever calling refresh; syncInfo is the demand.
    await setup.data.location.syncInfo()
    expect(setup.data.location.websearch.list()).toBeUndefined()
    emit(opened.directory)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests.filter((path) => path.startsWith("/api/websearch/provider"))).toEqual([
      `/api/websearch/provider?${opened.directory}`,
    ])
    expect(setup.data.location.websearch.list()).toMatchObject([{ id: "exa" }])
  } finally {
    setup.dispose()
  }
})

test("event refreshes report failures, remain retryable, and preserve explicit read errors", async () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const reported = Promise.withResolvers<unknown>()
  const errors: unknown[] = []
  const state = { offline: true, requests: 0 }
  const session: SessionInfo = {
    id: "ses_refresh_failure",
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0, idle: 2 },
    location: { directory: "/project" },
  }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async () => {
      state.requests++
      if (state.offline) throw new TypeError("Failed to fetch")
      return Response.json({ data: { ...session, title: "Recovered" } })
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
      onError(error) {
        errors.push(error)
        reported.resolve(error)
      },
    }),
    dispose,
  }))
  const event: OpenCodeEvent = {
    id: "evt_refresh_failure",
    created: 2,
    type: "session.viewed",
    durable: { aggregateID: session.id, seq: 1, version: 1 },
    data: { sessionID: session.id, idle: 2 },
  }
  try {
    setup.data.session.remember(session)
    setup.data.session.invalidate(session.id)
    await expect(setup.data.session.sync(session.id)).rejects.toThrow("Transport")
    expect(errors).toEqual([])
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    expect(String(await reported.promise)).toContain("Transport")
    expect(errors).toHaveLength(1)
    expect(setup.data.session.get(session.id)?.title).toBeUndefined()
    state.offline = false
    listeners.forEach((listener) => listener({ name: event.type, details: event }))
    await setup.data.session.sync(session.id)
    expect(setup.data.session.get(session.id)?.title).toBe("Recovered")
    expect(state.requests).toBe(3)
  } finally {
    setup.dispose()
  }
})

test.each(["reconnecting", "disposed"] as const)("background reads respect %s owners", async (mode) => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const pending = Promise.withResolvers<Response>()
  const errors: unknown[] = []
  const state = { requests: 0 }
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: () => {
      state.requests++
      return pending.promise
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
      connection: { status: () => (mode === "reconnecting" ? "reconnecting" : "connected") },
      onError: (error) => errors.push(error),
    }),
    dispose,
  }))
  const event: OpenCodeEvent = {
    id: "evt_refresh_owner",
    type: "command.updated",
    location: { directory: "/project" },
    data: {},
  }
  listeners.forEach((listener) => listener({ name: event.type, details: event }))
  if (mode === "reconnecting") {
    expect(state.requests).toBe(0)
    setup.dispose()
    return
  }
  const joined = setup.data.location.command.sync()
  setup.dispose()
  pending.reject(new TypeError("Failed to fetch"))
  await expect(joined).rejects.toThrow("Transport")
  expect(state.requests).toBe(1)
  expect(errors).toEqual([])
})
