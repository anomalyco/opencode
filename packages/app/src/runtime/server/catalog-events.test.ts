import { afterEach, describe, expect, test } from "bun:test"
import { OpenCode, type LocationRef, type OpenCodeEvent } from "@opencode-ai/client/promise"
import { createRoot } from "solid-js"
import { createOpenCodeEventSource } from "./client"
import { createAppData } from "./catalog-events"

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()))

function setup() {
  return createRoot((dispose) => {
    cleanups.push(dispose)
    const events = createOpenCodeEventSource()
    const calls: Array<{ path: string; location: LocationRef }> = []
    const api = OpenCode.make({
      baseUrl: "http://localhost:3000",
      fetch: Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(new Request(input, init).url)
          const location = {
            directory: url.searchParams.get("location[directory]") ?? "/default",
            workspaceID: url.searchParams.get("location[workspace]") ?? undefined,
          }
          calls.push({ path: url.pathname, location })
          if (url.pathname === "/api/health") return Response.json({ healthy: true, version: "2.0.0-test", pid: 1 })
          if (url.pathname === "/api/mcp") return Response.json({ location, data: [] })
          if (url.pathname === "/api/mcp/resource")
            return Response.json({ location, data: { resources: [], templates: [] } })
          throw new Error(`Unexpected request: ${url.pathname}`)
        },
        { preconnect() {} },
      ),
    })
    const data = createAppData({
      api: () => api,
      directory: "/default",
      event: {
        on: events.event.on,
        listen: (handler) => events.event.listen((event) => handler({ name: event.type, details: event })),
      },
      onError: (error) => {
        throw error
      },
    })
    const emit = (location: LocationRef) => {
      events.publish({
        id: "evt_status",
        created: 1,
        type: "mcp.status.changed",
        location,
        data: { server: "test" },
      })
      events.publish({
        id: "evt_resources",
        created: 2,
        type: "mcp.resources.changed",
        location,
        data: { server: "test" },
      })
    }
    return { data, calls, emit, events, api, dispose }
  })
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("desktop catalog events", () => {
  test("does not fetch MCP catalogs for hundreds of unopened locations", async () => {
    const input = setup()
    Array.from({ length: 400 }, (_, index) => input.emit({ directory: `/history/${index}` }))
    await settle()
    await input.api.health.get()
    expect(input.calls).toHaveLength(1)
    expect(input.calls[0].path).toBe("/api/health")
  })

  test("coalesces active MCP events and leaves unrelated locations deferred", async () => {
    const input = setup()
    const location = { directory: "/active" }
    const release = input.data.location.retain(location)
    Array.from({ length: 30 }, () => {
      input.emit(location)
      input.emit({ directory: "/history" })
    })
    await settle()
    await Promise.all([input.data.location.mcp.server.sync(location), input.data.location.mcp.resource.sync(location)])
    expect(input.calls).toHaveLength(2)
    expect(input.calls.every((call) => call.location.directory === location.directory)).toBe(true)
    release()
    input.emit(location)
    await settle()
    expect(input.calls).toHaveLength(2)
    const reopen = input.data.location.retain(location)
    await Promise.all([input.data.location.mcp.server.sync(location), input.data.location.mcp.resource.sync(location)])
    expect(input.calls).toHaveLength(4)
    reopen()
  })

  test("keeps shared owners active and distinguishes workspace identities", async () => {
    const input = setup()
    const location = { directory: "C:\\repo", workspaceID: "workspace_a" }
    const first = input.data.location.retain(location)
    const second = input.data.location.retain(location)
    first()
    input.emit({ directory: "C:/repo/", workspaceID: "workspace_a" })
    input.emit({ directory: "C:/repo/", workspaceID: "workspace_b" })
    await settle()
    expect(input.calls).toHaveLength(2)
    expect(input.calls.every((call) => call.location.workspaceID === "workspace_a")).toBe(true)
    second()
    input.emit(location)
    await settle()
    expect(input.calls).toHaveLength(2)
  })

  test("never suppresses session permission events for an unopened location", () => {
    const input = setup()
    const event = {
      id: "evt_permission",
      created: 1,
      type: "permission.asked",
      location: { directory: "/history" },
      data: {
        id: "perm_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**"],
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
    } satisfies Extract<OpenCodeEvent, { type: "permission.asked" }>
    input.events.publish(event)
    expect(input.data.session.permission.list("ses_1")).toEqual([event.data])
    expect(input.calls).toHaveLength(0)
  })

  test("refreshes a requested Windows path after changes arrive using a normalized alias", async () => {
    const input = setup()
    const location = { directory: "C:\\repo" }
    const release = input.data.location.retain(location)
    await input.data.location.mcp.server.sync(location)
    release()
    input.emit({ directory: "C:/repo/" })
    await settle()
    expect(input.calls).toHaveLength(1)
    const reopen = input.data.location.retain(location)
    await input.data.location.mcp.server.sync(location)
    expect(input.calls).toHaveLength(2)
    reopen()
  })

  test("keeps background questions visible without loading that location's MCP catalogs", () => {
    const input = setup()
    const event = {
      id: "evt_form",
      created: 1,
      type: "form.created",
      location: { directory: "/history" },
      data: {
        form: {
          id: "frm_question",
          sessionID: "ses_1",
          title: "Choose an option",
          fields: [{ key: "answer", type: "string" }],
        },
      },
    } satisfies Extract<OpenCodeEvent, { type: "form.created" }>
    input.events.publish(event)
    expect(input.data.session.form.list("ses_1")).toEqual([event.data.form])
    expect(input.calls).toHaveLength(0)
  })

  test("refreshes a mounted shared catalog independently of the project catalog", async () => {
    const input = setup()
    const project = input.data.location.retain({ directory: "/project" })
    await input.data.location.mcp.server.sync()
    const shared = input.data.location.retain(input.data.location.default())
    input.emit(input.data.location.default())
    await settle()
    await input.data.location.mcp.server.sync()
    expect(input.calls).toHaveLength(3)
    expect(input.calls.every((call) => call.location.directory === "/default")).toBe(true)
    shared()
    input.emit(input.data.location.default())
    await settle()
    expect(input.calls).toHaveLength(3)
    project()
  })

  test("does not dispatch a queued catalog refresh after its last owner closes", async () => {
    const input = setup()
    const release = input.data.location.retain({ directory: "/active" })
    input.emit({ directory: "/active" })
    release()
    await settle()
    expect(input.calls).toHaveLength(0)
  })

  test("disposes a queued refresh without starting requests", async () => {
    const input = setup()
    input.data.location.retain({ directory: "/active" })
    input.emit({ directory: "/active" })
    input.dispose()
    await settle()
    expect(input.calls).toHaveLength(0)
  })
})
