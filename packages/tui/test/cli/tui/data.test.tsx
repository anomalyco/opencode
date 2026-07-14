/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { EventV2 } from "@opencode-ai/core/event"
import { onMount } from "solid-js"
import { ProjectProvider } from "../../../src/context/project"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { createSessionRows, type SessionRow } from "../../../src/routes/session/rows"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"

const formFields = [{ key: "authorization", type: "external", url: "https://example.com" }] satisfies [
  {
    key: string
    type: "external"
    url: string
  },
]

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function emitEvent(events: ReturnType<typeof createEventStream>, event: OpenCodeEvent) {
  events.emit({ ...event, location: { directory } })
}

function durable(sessionID: string, seq?: number): { aggregateID: string; seq: number; version: 1 }
function durable<const Version extends number>(
  sessionID: string,
  seq: number,
  version: Version,
): { aggregateID: string; seq: number; version: Version }
function durable(sessionID: string, seq = 0, version = 1) {
  return { aggregateID: sessionID, seq, version }
}

test("bootstraps MCP data for the TUI location", async () => {
  const events = createEventStream()
  const requests: URL[] = []
  const calls = createFetch((url) => {
    if (url.pathname === "/api/mcp" || url.pathname === "/api/mcp/resource") requests.push(url)
    return undefined
  }, events)

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <box />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => requests.length === 2)
    expect(requests.map((url) => url.searchParams.get("location[directory]"))).toEqual([
      process.cwd(),
      process.cwd(),
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes MCP status when a connection settles during bootstrap", async () => {
  const events = createEventStream()
  let mcpRequests = 0
  let resolveModels!: (response: Response) => void
  const calls = createFetch((url) => {
    if (url.pathname === "/api/mcp") {
      mcpRequests++
      return json({
        location: { directory, project: { id: "proj_test", directory } },
        data: [{ name: "context7", status: { status: mcpRequests === 1 ? "pending" : "connected" } }],
      })
    }
    if (url.pathname === "/api/model")
      return new Promise<Response>((resolve) => {
        resolveModels = resolve
      })
    return undefined
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.location.mcp.server.list()?.[0]?.status.status === "pending")
    emitEvent(events, {
      id: "evt_mcp_connected",
      created: 1,
      type: "mcp.status.changed",
      data: { server: "context7" },
    })
    await wait(() => data.location.mcp.server.list()?.[0]?.status.status === "connected")
    expect(mcpRequests).toBe(2)
    resolveModels(json({ location: { directory, project: { id: "proj_test", directory } }, data: [] }))
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes resources into reactive getters", async () => {
  const events = createEventStream()
  const location = {
    directory,
    project: { id: "proj_test", directory },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/ses_test")
      return json({
        data: {
          id: "ses_test",
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Test session",
          location: { directory },
        },
      })
    if (url.pathname === "/api/session/ses_test/message")
      return json({
        data: [
          { id: "msg_second", created: 0, type: "user", text: "Second", time: { created: 2 } },
          { id: "msg_first", created: 0, type: "user", text: "First", time: { created: 1 } },
        ],
        cursor: {},
      })
    if (url.pathname === "/api/agent")
      return json({
        location,
        data: [{ id: "build", request: { headers: {}, body: {} }, mode: "primary", hidden: false, permissions: [] }],
      })
    return undefined
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <text>{data.session.message.get("ses_test", "msg_second")?.id ?? "missing"}</text>
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    expect(data.location.default()).toEqual({ directory: process.cwd() })
    expect(data.session.get("ses_test")).toBeUndefined()
    expect(data.location.agent.list(location)).toBeUndefined()

    await data.session.refresh("ses_test")
    await data.session.message.refresh("ses_test")
    await data.location.agent.refresh()

    expect(data.session.get("ses_test")?.title).toBe("Test session")
    expect(data.session.message.list("ses_test").map((message) => message.id)).toEqual(["msg_first", "msg_second"])
    expect(data.session.message.get("ses_test", "msg_second")?.id).toBe("msg_second")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("msg_second")
    expect(data.location.default()).toEqual({ directory, workspaceID: undefined })
    expect(data.location.agent.list(location)?.map((agent) => agent.id)).toEqual(["build"])
  } finally {
    app.renderer.destroy()
  }
})

test("applies absolute usage events to session info", async () => {
  const events = createEventStream()
  const sessionID = "ses_usage_refresh"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Usage",
          location: { directory },
        },
      })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await data.session.refresh(sessionID)
    emitEvent(events, {
      id: "evt_usage_2",
      created: 2,
      type: "session.usage.updated",
      data: {
        sessionID,
        cost: 0.5,
        tokens: { input: 5, output: 2, reasoning: 1, cache: { read: 1, write: 1 } },
      },
    })
    await wait(() => data.session.get(sessionID)?.cost === 0.5)
    expect(data.session.get(sessionID)?.tokens).toEqual({
      input: 5,
      output: 2,
      reasoning: 1,
      cache: { read: 1, write: 1 },
    })

    emitEvent(events, {
      id: "evt_usage_3",
      created: 3,
      type: "session.usage.updated",
      data: {
        sessionID,
        cost: 1,
        tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 1, write: 1 } },
      },
    })
    await wait(() => data.session.get(sessionID)?.cost === 1)
    expect(data.session.get(sessionID)?.title).toBe("Usage")

    emitEvent(events, {
      id: "evt_usage_deleted",
      created: 9,
      type: "session.deleted",
      durable: durable(sessionID, 9, 2),
      data: { sessionID },
    })
    await wait(() => data.session.get(sessionID) === undefined)
  } finally {
    app.renderer.destroy()
  }
})

test("truncates committed revert messages without changing lifetime usage", async () => {
  const events = createEventStream()
  const sessionID = "ses_revert_usage"
  let cost = 0
  let tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
    if (url.pathname !== `/api/session/${sessionID}`) return
    return json({
      data: {
        id: sessionID,
        projectID: "proj_test",
        cost,
        tokens,
        time: { created: 0, updated: 0 },
        title: "Revert usage",
        location: { directory },
      },
    })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await data.session.refresh(sessionID)
    emitEvent(events, {
      id: "evt_revert_boundary_started",
      created: 1,
      type: "session.step.started",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        assistantMessageID: "msg_revert_boundary",
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    cost = 0.5
    tokens = { input: 5, output: 2, reasoning: 1, cache: { read: 1, write: 1 } }
    emitEvent(events, {
      id: "evt_revert_boundary_ended",
      created: 2,
      type: "session.step.ended",
      durable: durable(sessionID, 2),
      data: {
        sessionID,
        assistantMessageID: "msg_revert_boundary",
        finish: "stop",
        cost: 0.5,
        tokens,
      },
    })
    emitEvent(events, {
      id: "evt_revert_boundary_usage",
      created: 2,
      type: "session.usage.updated",
      data: { sessionID, cost, tokens },
    })
    await wait(() => data.session.get(sessionID)?.cost === 0.5)

    emitEvent(events, {
      id: "evt_revert_later_started",
      created: 3,
      type: "session.step.started",
      durable: durable(sessionID, 3),
      data: {
        sessionID,
        assistantMessageID: "msg_revert_later",
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    cost = 0.75
    tokens = { input: 8, output: 3, reasoning: 1, cache: { read: 1, write: 1 } }
    emitEvent(events, {
      id: "evt_revert_later_ended",
      created: 4,
      type: "session.step.ended",
      durable: durable(sessionID, 4),
      data: {
        sessionID,
        assistantMessageID: "msg_revert_later",
        finish: "stop",
        cost: 0.25,
        tokens: { input: 3, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    emitEvent(events, {
      id: "evt_revert_later_usage",
      created: 4,
      type: "session.usage.updated",
      data: { sessionID, cost, tokens },
    })
    await wait(() => data.session.get(sessionID)?.cost === 0.75)
    emitEvent(events, {
      id: "evt_revert_staged",
      created: 5,
      type: "session.revert.staged",
      durable: durable(sessionID, 5),
      data: { sessionID, revert: { messageID: "msg_revert_later" } },
    })
    await wait(() => data.session.get(sessionID)?.revert?.messageID === "msg_revert_later")

    emitEvent(events, {
      id: "evt_revert_committed",
      created: 6,
      type: "session.revert.committed",
      durable: durable(sessionID, 6),
      data: { sessionID, to: "msg_revert_later" },
    })
    await wait(() => data.session.message.list(sessionID).length === 1)
    expect(data.session.get(sessionID)?.cost).toBe(0.75)
    expect(data.session.message.list(sessionID).map((message) => message.id)).toEqual(["msg_revert_boundary"])
    expect(data.session.get(sessionID)?.revert).toBeUndefined()
    expect(data.session.get(sessionID)?.tokens).toEqual(tokens)
  } finally {
    app.renderer.destroy()
  }
})

test("updates session location when moved", async () => {
  const events = createEventStream()
  const destination = "/tmp/opencode-moved"
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/ses_test")
      return json({
        data: {
          id: "ses_test",
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Test session",
          location: { directory },
        },
      })
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await data.session.refresh("ses_test")
    emitEvent(events, {
      id: "evt_moved_1",
      created: 1,
      type: "session.moved",
      durable: durable("ses_test"),
      data: {
        sessionID: "ses_test",
        location: { directory: destination },
        subpath: "packages/cli",
      },
    })
    await wait(() => data.session.get("ses_test")?.location.directory === destination)
    expect(data.session.get("ses_test")?.subpath).toBe("packages/cli")
  } finally {
    app.renderer.destroy()
  }
})

test("restores running manual compaction before applying live deltas", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-compaction/message")
      return json({
        data: [
          {
            id: "message-compaction",
            type: "compaction",
            status: "running",
            reason: "manual",
            summary: "Existing ",
            recent: "",
            time: { created: 1 },
          },
        ],
        cursor: {},
      })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await data.session.message.refresh("session-compaction")
    expect(data.session.message.get("session-compaction", "message-compaction")).toMatchObject({
      type: "compaction",
      status: "running",
      summary: "Existing ",
    })

    emitEvent(events, {
      id: "evt_compaction_delta",
      created: 2,
      type: "session.compaction.delta",
      data: { sessionID: "session-compaction", text: "summary" },
    })

    await wait(() => {
      const message = data.session.message.get("session-compaction", "message-compaction")
      return message?.type === "compaction" && message.status === "running" && message.summary === "Existing summary"
    })
  } finally {
    app.renderer.destroy()
  }
})

test("reconnects the event stream and bootstraps fresh data", async () => {
  const events = createEventStream()
  const requests = { active: 0, event: 0, message: 0, model: 0 }
  let resolveActive!: (response: Response) => void
  let resolveMessages!: (response: Response) => void
  const calls = createFetch((url) => {
    if (url.pathname === "/api/event") {
      requests.event++
      return events.v2()
    }
    if (url.pathname === "/api/session/active") {
      requests.active++
      if (requests.active === 1) return json({ data: { "session-stale": { type: "running" } } })
      return new Promise<Response>((resolve) => {
        resolveActive = resolve
      })
    }
    if (url.pathname === "/api/session/session-stale/message") {
      requests.message++
      if (requests.message === 1)
        return json({
          data: [{ id: "message-stale", type: "user", text: "Stale", time: { created: 1 } }],
          cursor: {},
        })
      return new Promise<Response>((resolve) => {
        resolveMessages = resolve
      })
    }
    if (url.pathname !== "/api/model") return
    requests.model++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data: [
        {
          id: `model-${requests.model}`,
          providerID: "provider",
          name: `Model ${requests.model}`,
          api: { type: "native" },
          capabilities: { tools: false, input: [], output: [] },
          cost: [],
          limit: { context: 1, output: 1 },
          request: { headers: {}, body: {} },
          status: "active",
          time: { released: 0 },
          variants: [],
        },
      ],
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    data = useData()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.location.model.list()?.[0]?.id === "model-1")
    await wait(() => data.session.status("session-stale") === "running")
    await data.session.message.refresh("session-stale")
    expect(data.session.message.get("session-stale", "message-stale")?.id).toBe("message-stale")
    expect(client.connection.status()).toBe("connected")
    expect(client.connection.attempt()).toBe(0)

    events.disconnect()
    await wait(() => client.connection.status() === "reconnecting")
    expect(client.connection.attempt()).toBe(1)
    expect(client.connection.error()).toBe("Event stream disconnected")

    await wait(() => requests.active === 2 && client.connection.status() === "connected", 4000)
    resolveActive(json({ data: { "session-new": { type: "running" } } }))

    await wait(() => data.location.model.list()?.[0]?.id === "model-2", 4000)
    await wait(() => data.session.status("session-stale") === "idle")
    await wait(() => requests.message === 2)
    expect(data.session.message.get("session-stale", "message-stale")?.id).toBe("message-stale")
    resolveMessages(
      json({
        data: [{ id: "message-fresh", type: "user", text: "Fresh", time: { created: 2 } }],
        cursor: {},
      }),
    )
    await wait(() => data.session.message.get("session-stale", "message-fresh") !== undefined)
    expect(data.session.message.get("session-stale", "message-stale")).toBeUndefined()
    await wait(() => data.session.status("session-new") === "running")
    expect(requests.event).toBe(2)
    expect(requests.message).toBe(2)
    expect(client.connection.status()).toBe("connected")
    expect(client.connection.attempt()).toBe(0)
    expect(client.connection.error()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("completes exploration when a queued prompt is promoted", async () => {
  const events = createEventStream()
  const sessionID = "session-promotion"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
  }, events)
  let rows!: ReturnType<typeof createSessionRows>

  function Probe() {
    rows = createSessionRows(() => sessionID)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    emitEvent(events, {
      id: "evt_step_started",
      created: 1,
      type: "session.step.started",
      durable: durable(sessionID),
      data: {
        sessionID,
        assistantMessageID: "message-assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    emitEvent(events, {
      id: "evt_tool_started",
      created: 2,
      type: "session.tool.input.started",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        assistantMessageID: "message-assistant",
        callID: "call-read",
        name: "read",
      },
    })
    await wait(() => rows.some((row) => row.type === "group" && !row.completed))

    emitEvent(events, {
      id: "evt_prompt_admitted",
      created: 3,
      type: "session.input.admitted",
      durable: durable(sessionID, 2),
      data: {
        sessionID,
        inputID: "message-user",
        input: { type: "user", data: { text: "Continue" }, delivery: "steer" },
      },
    })
    await wait(() => rows.at(-1)?.type === "message")
    expect(rows.find((row) => row.type === "group")?.completed).toBe(false)

    emitEvent(events, {
      id: "evt_prompt_promoted",
      created: 4,
      type: "session.input.promoted",
      durable: durable(sessionID, 3),
      data: { sessionID, inputID: "message-user" },
    })
    await wait(() => rows.find((row) => row.type === "group")?.completed === true)
    expect(rows.at(-1)).toEqual({ type: "message", messageID: "message-user" })
  } finally {
    app.renderer.destroy()
  }
})

test("classifies live tool rows independently of their call ID", async () => {
  const events = createEventStream()
  const sessionID = "session-tool-call-id"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
  }, events)
  let rows!: ReturnType<typeof createSessionRows>

  function Probe() {
    rows = createSessionRows(() => sessionID)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    emitEvent(events, {
      id: "evt_tool_started",
      created: 1,
      type: "session.tool.input.started",
      durable: durable(sessionID),
      data: {
        sessionID,
        assistantMessageID: "message-assistant",
        callID: "reasoning:0",
        name: "bash",
      },
    })

    await wait(() => rows.length > 0)
    expect(rows).toEqual([{ type: "part", ref: { messageID: "message-assistant", partID: "reasoning:0" } }])
  } finally {
    app.renderer.destroy()
  }
})

test("removes committed revert messages from local state", async () => {
  const events = createEventStream()
  const sessionID = "session-revert"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    for (const [seq, inputID] of ["msg_001", "msg_002", "msg_003"].entries()) {
      emitEvent(events, {
        id: EventV2.ID.create(),
        created: seq,
        type: "session.input.admitted",
        durable: durable(sessionID, seq),
        data: { sessionID, inputID, input: { type: "user", data: { text: inputID }, delivery: "steer" } },
      })
    }
    await wait(() => data.session.message.list(sessionID).length === 3)

    emitEvent(events, {
      id: EventV2.ID.create(),
      created: 3,
      type: "session.revert.committed",
      durable: durable(sessionID, 3),
      data: { sessionID, to: "msg_002" },
    })

    await wait(() => data.session.message.list(sessionID).length === 1)
    expect(data.session.message.list(sessionID).map((message) => message.id)).toEqual(["msg_001"])
    expect(data.session.message.get(sessionID, "msg_002")).toBeUndefined()
    expect(data.session.message.get(sessionID, "msg_003")).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("distinguishes initial connection from reconnection", async () => {
  const encoder = new TextEncoder()
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const eventResponse = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  const connect = () =>
    stream?.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ id: "evt_connected", created: 0, type: "server.connected", data: {} })}\n\n`,
      ),
    )
  const disconnect = () => {
    stream?.close()
    stream = undefined
  }

  const calls = createFetch((url) => {
    if (url.pathname === "/api/event") return eventResponse()
  })
  let client!: ReturnType<typeof useClient>

  function Probe() {
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => stream !== undefined)
    expect(client.connection.status()).toBe("connecting")

    connect()
    await wait(() => client.connection.status() === "connected")

    disconnect()
    await wait(() => client.connection.status() === "reconnecting")
  } finally {
    app.renderer.destroy()
  }
})

test("tracks session status from active sessions and execution events", async () => {
  const events = createEventStream()
  let settled = false
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/active") return json({ data: { "session-active": { type: "running" } } })
    if (url.pathname === "/api/session/session-live")
      return json({
        data: {
          id: "session-live",
          projectID: "proj_test",
          cost: settled ? 0.75 : 0,
          tokens: settled
            ? { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } }
            : { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Live session",
          location: { directory },
        },
      })
    if (url.pathname === "/api/session/session-failed")
      return json({
        data: {
          id: "session-failed",
          projectID: "proj_test",
          cost: 0.25,
          tokens: { input: 5, output: 1, reasoning: 1, cache: { read: 1, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Failed session",
          location: { directory },
        },
      })
  }, events)
  let data!: ReturnType<typeof useData>
  let rows!: SessionRow[]
  let manualRows!: SessionRow[]

  function Probe() {
    data = useData()
    rows = createSessionRows(() => "session-retry")
    manualRows = createSessionRows(() => "session-manual")
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.session.status("session-active") === "running")
    expect(data.session.status("session-idle")).toBe("idle")
    await data.session.refresh("session-live")

    settled = true
    emitEvent(events, {
      id: "evt_execution_started",
      created: 0,
      type: "session.execution.started",
      durable: durable("session-live"),
      data: { sessionID: "session-live" },
    })
    await wait(() => data.session.status("session-live") === "running")

    emitEvent(events, {
      id: "evt_step_started",
      created: 0,
      type: "session.step.started",
      durable: durable("session-live"),
      data: {
        sessionID: "session-live",
        assistantMessageID: "message-live",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    emitEvent(events, {
      id: "evt_step_ended",
      created: 0,
      type: "session.step.ended",
      durable: durable("session-live", 1),
      data: {
        sessionID: "session-live",
        assistantMessageID: "message-live",
        finish: "stop",
        cost: 0.75,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      },
    })
    emitEvent(events, {
      id: "evt_step_usage",
      created: 0,
      type: "session.usage.updated",
      data: {
        sessionID: "session-live",
        cost: 0.75,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get("session-live", "message-live")
      return assistant?.type === "assistant" && assistant.finish === "stop"
    })
    await wait(() => data.session.get("session-live")?.cost === 0.75)
    expect(data.session.status("session-live")).toBe("running")
    expect(data.session.get("session-live")).toMatchObject({
      cost: 0.75,
      tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
    })

    emitEvent(events, {
      id: "evt_execution_succeeded",
      created: 0,
      type: "session.execution.succeeded",
      durable: durable("session-live", 1),
      data: { sessionID: "session-live" },
    })
    await wait(() => data.session.status("session-live") === "idle")

    await data.session.refresh("session-failed")
    emitEvent(events, {
      id: "evt_failed_execution_started",
      created: 0,
      type: "session.execution.started",
      durable: durable("session-failed"),
      data: { sessionID: "session-failed" },
    })
    await wait(() => data.session.status("session-failed") === "running")

    emitEvent(events, {
      id: "evt_failed_step_started",
      created: 0,
      type: "session.step.started",
      durable: durable("session-failed"),
      data: {
        sessionID: "session-failed",
        assistantMessageID: "message-failed",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    emitEvent(events, {
      id: "evt_step_failed",
      created: 0,
      type: "session.step.failed",
      durable: durable("session-failed", 1),
      data: {
        sessionID: "session-failed",
        assistantMessageID: "message-failed",
        error: { type: "provider.content-filter", message: "Provider blocked the response" },
        cost: 0.25,
        tokens: { input: 5, output: 1, reasoning: 1, cache: { read: 1, write: 0 } },
      },
    })
    emitEvent(events, {
      id: "evt_failed_step_usage",
      created: 0,
      type: "session.usage.updated",
      data: {
        sessionID: "session-failed",
        cost: 0.25,
        tokens: { input: 5, output: 1, reasoning: 1, cache: { read: 1, write: 0 } },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get("session-failed", "message-failed")
      return (
        assistant?.type === "assistant" &&
        assistant.finish === "error" &&
        assistant.error?.type === "provider.content-filter"
      )
    })
    await wait(() => data.session.get("session-failed")?.cost === 0.25)
    expect(data.session.get("session-failed")?.tokens).toEqual({
      input: 5,
      output: 1,
      reasoning: 1,
      cache: { read: 1, write: 0 },
    })
    expect(data.session.status("session-failed")).toBe("running")

    emitEvent(events, {
      id: "evt_failed_execution_failed",
      created: 0,
      type: "session.execution.failed",
      durable: durable("session-failed", 1),
      data: {
        sessionID: "session-failed",
        error: { type: "provider.content-filter", message: "Provider blocked the response" },
      },
    })
    await wait(() => data.session.status("session-failed") === "idle")

    emitEvent(events, {
      id: "evt_retry_execution_started",
      created: 0,
      type: "session.execution.started",
      durable: durable("session-retry"),
      data: { sessionID: "session-retry" },
    })
    emitEvent(events, {
      id: "evt_retry_step_started",
      created: 0,
      type: "session.step.started",
      durable: durable("session-retry", 1),
      data: {
        sessionID: "session-retry",
        assistantMessageID: "message-retry",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    emitEvent(events, {
      id: "evt_retry_scheduled",
      created: 0,
      type: "session.retry.scheduled",
      durable: durable("session-retry", 1),
      data: {
        sessionID: "session-retry",
        assistantMessageID: "message-retry",
        attempt: 2,
        at: 2_000,
        error: { type: "provider.transport", message: "Disconnected" },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get("session-retry", "message-retry")
      return assistant?.type === "assistant" && assistant.retry?.attempt === 2
    })
    await wait(() => rows.some((row) => row.type === "assistant-footer" && row.messageID === "message-retry"))
    emitEvent(events, {
      id: "evt_retry_next_step",
      created: 2_000,
      type: "session.step.started",
      durable: durable("session-retry", 1),
      data: {
        sessionID: "session-retry",
        assistantMessageID: "message-retry",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get("session-retry", "message-retry")
      return assistant?.type === "assistant" && assistant.retry === undefined
    })
    await wait(() => !rows.some((row) => row.type === "assistant-footer" && row.messageID === "message-retry"))
    expect(data.session.message.list("session-retry").filter((message) => message.type === "assistant")).toHaveLength(1)
    emitEvent(events, {
      id: "evt_retry_scheduled_again",
      created: 2_000,
      type: "session.retry.scheduled",
      durable: durable("session-retry", 1),
      data: {
        sessionID: "session-retry",
        assistantMessageID: "message-retry",
        attempt: 3,
        at: 6_000,
        error: { type: "provider.transport", message: "Disconnected again" },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get("session-retry", "message-retry")
      return assistant?.type === "assistant" && assistant.retry?.attempt === 3
    })
    emitEvent(events, {
      id: "evt_retry_interrupted",
      created: 2_000,
      type: "session.execution.interrupted",
      durable: durable("session-retry", 1),
      data: { sessionID: "session-retry", reason: "shutdown" },
    })
    await wait(() => data.session.status("session-retry") === "idle")
    expect(data.session.message.get("session-retry", "message-retry")).not.toHaveProperty("retry")

    emitEvent(events, {
      id: "evt_manual_compaction_admitted",
      created: 0,
      type: "session.compaction.admitted",
      durable: durable("session-manual", 1),
      data: { sessionID: "session-manual", inputID: "message-compaction" },
    })
    await wait(() => data.session.compaction.list("session-manual").includes("message-compaction"))
    emitEvent(events, {
      id: "evt_manual_compaction_started",
      created: 1,
      type: "session.compaction.started",
      durable: durable("session-manual", 2),
      data: { sessionID: "session-manual", reason: "manual", recent: "", inputID: "message-compaction" },
    })
    emitEvent(events, {
      id: "evt_manual_compaction_delta",
      created: 2,
      type: "session.compaction.delta",
      data: { sessionID: "session-manual", text: "Streamed summary" },
    })
    await wait(() => {
      const message = data.session.message.get("session-manual", "message-compaction")
      return message?.type === "compaction" && message.status === "running" && message.summary === "Streamed summary"
    })
    expect(data.session.compaction.list("session-manual")).toEqual([])
    const compactionRow = manualRows.find(
      (row) => row.type === "message" && row.messageID === "message-compaction",
    )
    emitEvent(events, {
      id: "evt_manual_compaction_ended",
      created: 3,
      type: "session.compaction.ended",
      durable: durable("session-manual", 4),
      data: { sessionID: "session-manual", reason: "manual", text: "Streamed summary", recent: "recent" },
    })
    await wait(() => {
      const message = data.session.message.get("session-manual", "message-compaction")
      return message?.type === "compaction" && message.status === "completed"
    })
    expect(manualRows.filter((row) => row.type === "message")).toEqual([
      { type: "message", messageID: "message-compaction" },
    ])
    expect(manualRows.find((row) => row.type === "message" && row.messageID === "message-compaction")).toBe(
      compactionRow,
    )

    emitEvent(events, {
      id: "evt_compaction_started",
      created: 0,
      type: "session.compaction.started",
      durable: durable("session-live", 2),
      data: { sessionID: "session-live", reason: "auto", recent: "" },
    })
    emitEvent(events, {
      id: "evt_compaction_delta_1",
      created: 0,
      type: "session.compaction.delta",
      data: { sessionID: "session-live", text: "Live " },
    })
    emitEvent(events, {
      id: "evt_compaction_delta_2",
      created: 0,
      type: "session.compaction.delta",
      data: { sessionID: "session-live", text: "summary" },
    })
    await wait(() => {
      const message = data.session.message.get("session-live", "msg_compaction_started")
      return message?.type === "compaction" && message.status === "running" && message.summary === "Live summary"
    })
    const autoCompactionRow = rows.find(
      (row) => row.type === "message" && row.messageID === "msg_compaction_started",
    )

    emitEvent(events, {
      id: "evt_compaction_ended",
      created: 0,
      type: "session.compaction.ended",
      durable: durable("session-live", 5),
      data: { sessionID: "session-live", reason: "auto", text: "Live summary", recent: "recent" },
    })
    await wait(() => {
      const message = data.session.message.get("session-live", "msg_compaction_started")
      return message?.type === "compaction" && message.status === "completed"
    })
    expect(data.session.message.get("session-live", "msg_compaction_started")).toMatchObject({
      type: "compaction",
      status: "completed",
      summary: "Live summary",
    })
    expect(rows.find((row) => row.type === "message" && row.messageID === "msg_compaction_started")).toBe(
      autoCompactionRow,
    )
    expect(rows.some((row) => row.type === "message" && row.messageID === "msg_compaction_ended")).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test("restores queued compaction from durable pending input", async () => {
  const events = createEventStream()
  const sessionID = "session-compaction-queued"
  let pending = [
    {
      admittedSeq: 3,
      id: "message-compaction-queued",
      sessionID,
      timeCreated: 1,
      type: "compaction" as const,
    },
    {
      admittedSeq: 4,
      id: "message-compaction-later",
      sessionID,
      timeCreated: 2,
      type: "compaction" as const,
    },
  ]
  const calls = createFetch((url) => {
    if (url.pathname !== `/api/session/${sessionID}/pending`) return
    return json({ data: pending })
  }, events)
  let data!: ReturnType<typeof useData>
  let rows!: ReturnType<typeof createSessionRows>

  function Probe() {
    data = useData()
    rows = createSessionRows(() => sessionID)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.session.compaction.list(sessionID).length === 2)
    expect(data.session.compaction.list(sessionID)).toEqual([
      "message-compaction-queued",
      "message-compaction-later",
    ])
    await wait(() => rows.filter((row) => row.type === "compaction-queued").length === 2)
    expect(rows.filter((row) => row.type === "compaction-queued")).toEqual([
      { type: "compaction-queued", inputID: "message-compaction-queued" },
      { type: "compaction-queued", inputID: "message-compaction-later" },
    ])

    emitEvent(events, {
      id: "evt_text_ended",
      created: 2,
      type: "session.text.ended",
      durable: durable(sessionID, 5),
      data: {
        sessionID,
        assistantMessageID: "message-assistant",
        ordinal: 0,
        text: "Active output",
      },
    })
    await wait(() => rows.some((row) => row.type === "part"))
    expect(rows.map((row) => row.type)).toEqual(["part", "compaction-queued", "compaction-queued"])

    emitEvent(events, {
      id: "evt_compaction_started",
      created: 2,
      type: "session.compaction.started",
      durable: durable(sessionID, 4),
      data: {
        sessionID,
        reason: "manual",
        recent: "",
        inputID: "message-compaction-queued",
      },
    })
    await wait(() => data.session.compaction.list(sessionID).length === 1)
    expect(data.session.compaction.list(sessionID)).toEqual(["message-compaction-later"])

    emitEvent(events, {
      id: "evt_compaction_ended",
      created: 3,
      type: "session.compaction.ended",
      durable: durable(sessionID, 5),
      data: { sessionID, reason: "manual", text: "Summary", recent: "" },
    })
    expect(data.session.compaction.list(sessionID)).toEqual(["message-compaction-later"])

    pending = []
    emitEvent(events, {
      id: "evt_reconnected",
      type: "server.connected",
      data: {},
    })
    await wait(() => data.session.compaction.list(sessionID).length === 0)
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes integrations after integration updates", async () => {
  const events = createEventStream()
  const requests = { integration: 0, model: 0, provider: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/model") {
      requests.model++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname === "/api/provider") {
      requests.provider++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname !== "/api/integration") return
    requests.integration++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data:
        requests.integration === 1
          ? []
          : [
              {
                id: "openai",
                name: "OpenAI",
                methods: [{ type: "key" }],
              },
            ],
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await wait(() => data.location.integration.list() !== undefined)
    expect(data.location.integration.list()).toEqual([])
    const before = { ...requests }

    emitEvent(events, { id: "evt_integration", created: 0, type: "integration.updated", data: {} })
    await wait(() => data.location.integration.list()?.length === 1)
    await wait(() => requests.model > before.model && requests.provider > before.provider)
    expect(data.location.integration.list()?.[0]).toMatchObject({ id: "openai", name: "OpenAI" })
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes MCP resources after catalog updates", async () => {
  const events = createEventStream()
  let requests = 0
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/mcp/resource") return
    requests++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data: {
        resources:
          requests === 1
            ? []
            : [{ server: "docs", name: "API reference", uri: "https://example.com/api", description: "API docs" }],
        templates: [],
      },
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await wait(() => data.location.mcp.resource.list() !== undefined)
    expect(data.location.mcp.resource.list()).toEqual([])

    emitEvent(events, {
      id: "evt_mcp_resources",
      created: 0,
      type: "mcp.resources.changed",
      data: { server: "docs" },
    })
    await wait(() => data.location.mcp.resource.list()?.length === 1)
    expect(data.location.mcp.resource.list()?.[0]).toEqual({
      server: "docs",
      name: "API reference",
      uri: "https://example.com/api",
      description: "API docs",
    })
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes effective catalog data after catalog updates", async () => {
  const events = createEventStream()
  const requests = { model: 0, provider: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/model") {
      requests.model++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
    if (url.pathname === "/api/provider") {
      requests.provider++
      return json({ location: { directory, project: { id: "proj_test", directory } }, data: [] })
    }
  }, events)

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <box />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => requests.model > 0 && requests.provider > 0)
    const before = { ...requests }
    emitEvent(events, { id: "evt_catalog", created: 0, type: "catalog.updated", data: {} })
    await wait(() => requests.model > before.model && requests.provider > before.provider)
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes agents after agent updates", async () => {
  const events = createEventStream()
  let requests = 0
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/agent") return
    requests++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data: [
        {
          id: requests === 1 ? "build" : "reviewer",
          request: { headers: {}, body: {} },
          mode: "primary",
          hidden: false,
          permissions: [],
        },
      ],
    })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.location.agent.list()?.[0]?.id === "build")
    emitEvent(events, { id: "evt_agent", created: 0, type: "agent.updated", data: {} })
    await wait(() => data.location.agent.list()?.[0]?.id === "reviewer")
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes references after updates", async () => {
  const events = createEventStream()
  let requests = 0
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/reference") return
    requests++
    return json({
      location: { directory, project: { id: "proj_test", directory } },
      data: requests === 1 ? [] : [{ name: "docs", path: "/docs", source: { type: "local", path: "/docs" } }],
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await wait(() => requests === 1)
    emitEvent(events, { id: "evt_reference_1", created: 0, type: "reference.updated", data: {} })
    await wait(() => data.location.reference.list()?.length === 1)
    expect(data.location.reference.list()?.[0]?.name).toBe("docs")
  } finally {
    app.renderer.destroy()
  }
})

test("keeps shell state scoped to location", async () => {
  const events = createEventStream()
  const other = "/tmp/opencode/other"
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/shell") return
    const requestDirectory = url.searchParams.get("location[directory]")
    return json({
      location: {
        directory: requestDirectory ?? directory,
        project: { id: "proj_test", directory: requestDirectory ?? directory },
      },
      data: [
        {
          id: requestDirectory === other ? "sh_other" : "sh_default",
          status: "running",
          command: requestDirectory === other ? "pnpm dev" : "bun test",
          cwd: requestDirectory ?? directory,
          shell: "/bin/sh",
          file: "/tmp/opencode-shell",
          metadata: { sessionID: requestDirectory === other ? "ses_other" : "ses_default" },
          time: { started: 1 },
        },
      ],
    })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.shell.list().some((shell) => shell.id === "sh_default"))
    await data.shell.refresh({ directory: other })

    expect(data.shell.list().map((shell) => shell.id)).toEqual(["sh_default"])
    expect(data.shell.list({ directory: other }).map((shell) => shell.id)).toEqual(["sh_other"])

    events.emit({
      id: "evt_shell_created",
      created: 0,
      type: "shell.created",
      location: { directory: other },
      data: {
        info: {
          id: "sh_live_other",
          status: "running",
          command: "npm run watch",
          cwd: other,
          shell: "/bin/sh",
          file: "/tmp/opencode-shell-live",
          metadata: { sessionID: "ses_other" },
          time: { started: 2 },
        },
      },
    })
    await wait(() => data.shell.list({ directory: other }).some((shell) => shell.id === "sh_live_other"))
    expect(data.shell.list().map((shell) => shell.id)).toEqual(["sh_default"])
  } finally {
    app.renderer.destroy()
  }
})

test("adds and dismisses permission requests from live events", async () => {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    data = useData()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => client.connection.status() === "connected")
    emitEvent(events, {
      id: "evt_permission_asked_1",
      created: 0,
      type: "permission.v2.asked",
      data: {
        id: "per_1",
        sessionID: "ses_1",
        action: "bash",
        resources: ["bun test"],
      },
    })
    emitEvent(events, {
      id: "evt_permission_asked_2",
      created: 0,
      type: "permission.v2.asked",
      data: {
        id: "per_2",
        sessionID: "ses_1",
        action: "read",
        resources: [".env"],
      },
    })
    await wait(() => data.session.permission.list("ses_1")?.length === 2)

    emitEvent(events, {
      id: "evt_permission_replied_1",
      created: 0,
      type: "permission.v2.replied",
      data: { sessionID: "ses_1", requestID: "per_1", reply: "once" },
    })
    await wait(() => data.session.permission.list("ses_1")?.length === 1)
    expect(data.session.permission.list("ses_1")?.[0]?.id).toBe("per_2")

    emitEvent(events, {
      id: "evt_permission_replied_2",
      created: 0,
      type: "permission.v2.replied",
      data: { sessionID: "ses_1", requestID: "per_2", reply: "reject" },
    })
    await wait(() => data.session.permission.list("ses_1")?.length === 0)
  } finally {
    app.renderer.destroy()
  }
})

test("reconciles all pending permission requests when the event stream reconnects", async () => {
  const events = createEventStream()
  let requests = [
    { id: "per_old", sessionID: "ses_old", action: "read", resources: ["old.txt"] },
    { id: "per_keep", sessionID: "ses_keep", action: "shell", resources: ["bun test"] },
  ]
  let calls = 0
  const fetch = createFetch((url) => {
    if (url.pathname !== "/api/permission/request") return
    calls++
    return json({ location: { directory, project: { id: "proj_test", directory } }, data: requests })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(fetch.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.session.permission.list("ses_old")?.[0]?.id === "per_old")
    expect(data.session.permission.list("ses_keep")?.[0]?.id).toBe("per_keep")

    requests = [{ id: "per_new", sessionID: "ses_new", action: "edit", resources: ["new.txt"] }]
    events.disconnect()

    await wait(() => calls === 2 && data.session.permission.list("ses_new")?.[0]?.id === "per_new")
    expect(data.session.permission.list("ses_old")).toBeUndefined()
    expect(data.session.permission.list("ses_keep")).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("adds, dismisses, and refreshes form requests", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session/ses_1/form") return
    return json({
      data: [{ id: "frm_remote", sessionID: "ses_1", title: "Input requested", fields: formFields }],
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    data = useData()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => client.connection.status() === "connected")
    emitEvent(events, {
      id: "evt_form_created_1",
      created: 0,
      type: "form.created",
      data: { form: { id: "frm_1", sessionID: "ses_1", title: "Input requested", fields: formFields } },
    })
    emitEvent(events, {
      id: "evt_form_created_duplicate",
      created: 1,
      type: "form.created",
      data: { form: { id: "frm_1", sessionID: "ses_1", title: "Input requested", fields: formFields } },
    })
    await wait(() => data.session.form.list("ses_1")?.length === 1)

    emitEvent(events, {
      id: "evt_form_replied_1",
      created: 2,
      type: "form.replied",
      data: { sessionID: "ses_1", id: "frm_1", answer: {} },
    })
    await wait(() => data.session.form.list("ses_1")?.length === 0)

    emitEvent(events, {
      id: "evt_form_created_2",
      created: 3,
      type: "form.created",
      data: { form: { id: "frm_2", sessionID: "ses_1", title: "Input requested", fields: formFields } },
    })
    emitEvent(events, {
      id: "evt_form_cancelled_2",
      created: 4,
      type: "form.cancelled",
      data: { sessionID: "ses_1", id: "frm_2" },
    })
    await wait(() => data.session.form.list("ses_1")?.length === 0)

    await data.session.form.refresh("ses_1")
    expect(data.session.form.list("ses_1")?.map((form) => form.id)).toEqual(["frm_remote"])
  } finally {
    app.renderer.destroy()
  }
})

test("tracks global forms by location", async () => {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const other = { directory: "/tmp/opencode-other", workspaceID: "wrk_other" }
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    data = useData()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => client.connection.status() === "connected")
    events.emit({
      id: "evt_form_created_global_other",
      created: 0,
      location: other,
      type: "form.created",
      data: {
        form: { id: "frm_other", sessionID: "global", title: "Input requested", fields: formFields },
      },
    })

    await wait(() => data.session.form.list("global", other)?.length === 1)
    expect(data.session.form.list("global", { directory }) ?? []).toEqual([])

    events.emit({
      id: "evt_form_created_global_default",
      created: 1,
      location: { directory },
      type: "form.created",
      data: {
        form: { id: "frm_default", sessionID: "global", title: "Input requested", fields: formFields },
      },
    })
    await wait(() => data.session.form.list("global", { directory })?.length === 1)

    events.emit({
      id: "evt_form_replied_global_other",
      created: 2,
      location: other,
      type: "form.replied",
      data: { id: "frm_other", sessionID: "global", answer: {} },
    })
    await wait(() => data.session.form.list("global", other)?.length === 0)
    expect(data.session.form.list("global", { directory })?.map((form) => form.id)).toEqual(["frm_default"])
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes global forms for the requested location", async () => {
  const events = createEventStream()
  const requests: URL[] = []
  const other = { directory: "/tmp/opencode-other", workspaceID: "wrk_other" }
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/form/request") return
    requests.push(url)
    const requestedDirectory = url.searchParams.get("location[directory]") ?? directory
    const requestedWorkspace = url.searchParams.get("location[workspace]") ?? undefined
    return json({
      location: {
        directory: requestedDirectory,
        workspaceID: requestedWorkspace,
        project: { id: "proj_test", directory: requestedDirectory },
      },
      data: [
        {
          id: requestedDirectory === other.directory ? "frm_other" : "frm_default",
          sessionID: "global",
          title: "Input requested",
          fields: formFields,
        },
      ],
    })
  }, events)
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    data = useData()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => client.connection.status() === "connected" && requests.length > 0)
    requests.length = 0

    await data.session.form.refresh("global", { directory })
    await data.session.form.refresh("global", other)

    expect(requests).toHaveLength(2)
    expect(requests[1]?.searchParams.get("location[directory]")).toBe(other.directory)
    expect(requests[1]?.searchParams.get("location[workspace]")).toBe(other.workspaceID)
    expect(data.session.form.list("global", other)?.map((form) => form.id)).toEqual(["frm_other"])
    expect(data.session.form.list("global", { directory })?.map((form) => form.id)).toEqual(["frm_default"])
  } finally {
    app.renderer.destroy()
  }
})

test("refreshes global forms once per loaded location after reconnect", async () => {
  const events = createEventStream()
  const requests: URL[] = []
  const counts = new Map<string, number>()
  const home = { directory: process.cwd() }
  const other = { directory: "/tmp/opencode-other", workspaceID: "wrk_other" }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location")
      return json({ ...home, project: { id: "proj_test", directory: home.directory } })
    if (url.pathname === "/api/session")
      return json({
        data: [
          { id: "ses_default", title: "Default", location: home, time: { created: 0, updated: 0 } },
          { id: "ses_other_1", title: "Other one", location: other, time: { created: 0, updated: 0 } },
          { id: "ses_other_2", title: "Other two", location: other, time: { created: 0, updated: 0 } },
        ],
        cursor: {},
      })
    if (url.pathname !== "/api/form/request") return
    requests.push(url)
    const requestedDirectory = url.searchParams.get("location[directory]") ?? home.directory
    const requestedWorkspace = url.searchParams.get("location[workspace]") ?? undefined
    const count = (counts.get(requestedDirectory) ?? 0) + 1
    counts.set(requestedDirectory, count)
    return json({
      location: {
        directory: requestedDirectory,
        workspaceID: requestedWorkspace,
        project: { id: "proj_test", directory: requestedDirectory },
      },
      data: [
        {
          id: `frm_${requestedDirectory === other.directory ? "other" : "default"}_${count}`,
          sessionID: "global",
          title: "Input requested",
          fields: formFields,
        },
      ],
    })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(
      () =>
        data.session.form.list("global", home)?.[0]?.id === "frm_default_1" &&
        data.session.form.list("global", other)?.[0]?.id === "frm_other_1",
    )
    expect(requests).toHaveLength(2)
    requests.length = 0

    events.disconnect()

    await wait(
      () =>
        data.session.form.list("global", home)?.[0]?.id === "frm_default_2" &&
        data.session.form.list("global", other)?.[0]?.id === "frm_other_2",
      4000,
    )
    expect(requests).toHaveLength(2)
    expect(
      requests.map((url) => [
        url.searchParams.get("location[directory]") ?? directory,
        url.searchParams.get("location[workspace]") ?? undefined,
      ]),
    ).toEqual([
      [home.directory, undefined],
      [other.directory, other.workspaceID],
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("reconciles all pending form requests when the event stream reconnects", async () => {
  const events = createEventStream()
  let requests = [
    { id: "frm_old", sessionID: "ses_old", title: "Input requested", fields: formFields },
    {
      id: "frm_keep",
      sessionID: "ses_keep",
      title: "Input requested",
      fields: [{ key: "authorization", type: "external" as const, url: "https://example.com" }],
    },
  ]
  let calls = 0
  const fetch = createFetch((url) => {
    if (url.pathname !== "/api/form/request") return
    calls++
    return json({ location: { directory, project: { id: "proj_test", directory } }, data: requests })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(fetch.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.session.form.list("ses_old")?.[0]?.id === "frm_old")
    expect(data.session.form.list("ses_keep")?.[0]?.id).toBe("frm_keep")

    requests = [{ id: "frm_new", sessionID: "ses_new", title: "Input requested", fields: formFields }]
    events.disconnect()

    await wait(() => calls === 2 && data.session.form.list("ses_new")?.[0]?.id === "frm_new")
    expect(data.session.form.list("ses_old")).toBeUndefined()
    expect(data.session.form.list("ses_keep")).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("settles pending tools when a live failure arrives", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message/msg_model_1")
      return json({
        data: {
          id: "msg_model_1",
          type: "model-switched",
          previous: { id: "model-1", providerID: "provider-1", variant: "medium" },
          model: { id: "model-1", providerID: "provider-1", variant: "high" },
          time: { created: 0 },
        },
      })
  }, events)
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_agent_1",
      created: 0,
      type: "session.agent.selected",
      durable: durable("session-1"),
      data: { sessionID: "session-1", agent: "build" },
    })
    emitEvent(events, {
      id: "evt_model_1",
      created: 0,
      type: "session.model.selected",
      durable: durable("session-1", 1),
      data: {
        sessionID: "session-1",
        model: { id: "model-1", providerID: "provider-1", variant: "high" },
      },
    })
    emitEvent(events, {
      id: "evt_step_started_1",
      created: 0,
      type: "session.step.started",
      durable: durable("session-1", 2),
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        agent: "build",
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitEvent(events, {
      id: "evt_input_1",
      created: 0,
      type: "session.tool.input.started",
      durable: durable("session-1", 3),
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        name: "bash",
      },
    })
    emitEvent(events, {
      id: "evt_called_1",
      created: 0,
      type: "session.tool.called",
      durable: durable("session-1", 4),
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        input: {},
        executed: false,
        state: { call: true },
      },
    })
    emitEvent(events, {
      id: "evt_progress_1",
      created: 0,
      type: "session.tool.progress",
      durable: durable("session-1", 5),
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        structured: { sessionID: "session-child", status: "running" },
        content: [],
      },
    })

    await wait(() => {
      const assistant = sync.session.message.get("session-1", "msg_explicit_assistant_9")
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "running" &&
        assistant.content[0].state.structured.sessionID === "session-child"
      )
    })

    emitEvent(events, {
      id: "evt_failed_1",
      created: 0,
      type: "session.tool.failed",
      durable: durable("session-1", 6),
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        error: { type: "unknown", message: "aborted" },
        executed: false,
        resultState: { result: true },
      },
    })

    await wait(() => {
      const assistant = sync.session.message.get("session-1", "msg_explicit_assistant_9")
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "error"
      )
    })

    const assistant = sync.session.message.get("session-1", "msg_explicit_assistant_9")
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") return
    expect(assistant.id).toBe("msg_explicit_assistant_9")
    const tool = assistant.content[0]
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") return
    expect(tool.state.status).toBe("error")
    if (tool.state.status !== "error") return
    expect(tool.state.error).toEqual({ type: "unknown", message: "aborted" })
    expect(tool.state.input).toEqual({})
    expect(tool.state.structured).toEqual({ sessionID: "session-child", status: "running" })
    expect(tool.state.content).toEqual([])
    expect(tool.executed).toBe(false)
    expect(tool.providerState).toEqual({ call: true })
    expect(tool.providerResultState).toEqual({ result: true })
    expect(sync.session.message.list("session-1").map((message) => message.type)).toEqual([
      "agent-switched",
      "model-switched",
      "assistant",
    ])
    expect(sync.session.message.get("session-1", "msg_model_1")).toMatchObject({
      type: "model-switched",
      previous: { id: "model-1", providerID: "provider-1", variant: "medium" },
      model: { id: "model-1", providerID: "provider-1", variant: "high" },
    })
  } finally {
    app.renderer.destroy()
  }
})

test("renders admitted prompts immediately and tracks them until promoted", async () => {
  const events = createEventStream()
  const sessionID = "session-1"
  const messageID = "msg_user_1"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`)
      return json({
        data: [{ id: messageID, type: "user", text: "hello", time: { created: 0 } }],
        cursor: {},
      })
  }, events)
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    const received: string[] = []
    const unsubscribe = sync.listen((event) => received.push(event.name))
    emitEvent(events, {
      id: "evt_admitted_1",
      created: 0,
      type: "session.input.admitted",
      durable: durable(sessionID),
      data: {
        sessionID,
        inputID: messageID,
        input: { type: "user", data: { text: "hello" }, delivery: "steer" },
      },
    })
    await wait(() => sync.session.message.list(sessionID)?.length === 1)
    const admitted = sync.session.message.list(sessionID)?.[0]
    expect(admitted).toMatchObject({ id: messageID, type: "user", text: "hello" })
    expect(admitted?.metadata).toBeUndefined()
    expect(sync.session.pending.list(sessionID)).toEqual([
      {
        id: messageID,
        sessionID,
        admittedSeq: 0,
        timeCreated: 0,
        type: "user",
        data: { text: "hello" },
        delivery: "steer",
      },
    ])
    expect(sync.session.input.list(sessionID)).toEqual([messageID])

    await sync.session.message.refresh(sessionID)
    expect(sync.session.message.list(sessionID)?.[0]?.metadata).toBeUndefined()

    emitEvent(events, {
      id: "evt_prompted_1",
      created: 0,
      type: "session.input.promoted",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        inputID: messageID,
      },
    })

    await wait(() => received.at(-1) === "session.input.promoted")
    expect(received.slice(-2)).toEqual(["session.input.admitted", "session.input.promoted"])
    unsubscribe()
    const message = sync.session.message.list(sessionID)?.[0]
    expect(message?.type).toBe("user")
    if (message?.type !== "user") return
    expect(message).toMatchObject({ id: messageID, text: "hello" })
    expect(message.metadata).toBeUndefined()
    expect(sync.session.pending.list(sessionID)).toEqual([])
    expect(sync.session.input.list(sessionID)).toEqual([])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])
    expect(sync.session.message.list("missing")).toEqual([])
    expect(sync.session.message.get(sessionID, messageID)).toBe(message)
    expect(sync.session.message.get(sessionID, "missing")).toBeUndefined()
    expect(received).toHaveLength(3)
  } finally {
    app.renderer.destroy()
  }
})

test("skips initial instruction state and projects later updates with their message ID", async () => {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  let sync!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_instructions_1",
      created: 0,
      type: "session.instructions.updated",
      durable: durable("session-1", 0, 2),
      metadata: { instructions: { initial: true } },
      data: {
        sessionID: "session-1",
        delta: { "core/date": "0".repeat(64) },
      },
    })
    emitEvent(events, {
      id: "evt_instructions_2",
      created: 1,
      type: "session.instructions.updated",
      durable: durable("session-1", 1, 2),
      data: {
        sessionID: "session-1",
        delta: { "core/date": "1".repeat(64) },
      },
    })

    await wait(() => sync.session.message.list("session-1")?.some((message) => message.time.created === 1))
    expect(sync.session.message.list("session-1")).toHaveLength(1)
    expect(sync.session.message.list("session-1")?.[0]).toMatchObject({
      id: SessionMessage.ID.fromEvent(EventV2.ID.make("evt_instructions_2")),
      type: "system",
      text: "Instructions updated: core/date",
      time: { created: 1 },
    })
  } finally {
    app.renderer.destroy()
  }
})

function sessionInfo(id: string, parentID: string | undefined, cost = 0) {
  return {
    id,
    parentID,
    projectID: "proj_test",
    cost,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    title: id,
    location: { directory },
  }
}

// Mounts a DataProvider whose `/api/session/:id` responses are driven by the
// given parent map (sessionID -> parentID). Roots omit the entry. Reused across
// the family-index tests below.
async function mountData(parents: Record<string, string>, costs: Record<string, number> = {}) {
  const calls = createFetch((url) => {
    const match = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (match && match[1] !== "active")
      return json({ data: sessionInfo(match[1], parents[match[1]], costs[match[1]]) })
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })
  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }
  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))
  await mounted
  return { data, app }
}

test("groups an orphan child under its missing parent until the root arrives", async () => {
  const { data, app } = await mountData({ child: "root" })
  try {
    await data.session.refresh("child")
    // Parent info is absent, so the missing parent is the furthest-known ancestor.
    expect(data.session.root("child")).toBe("root")
    expect(data.session.family("child")).toEqual(["child"])
    expect(data.session.family("root")).toEqual(["child"])

    await data.session.refresh("root")
    expect(data.session.root("root")).toBe("root")
    // The tentative root entry folds into the now-known root's family.
    expect(data.session.family("child")).toEqual(["child", "root"])
    expect(data.session.family("root")).toEqual(["child", "root"])
  } finally {
    app.renderer.destroy()
  }
})

test("indexes arbitrarily deep nesting under a single root", async () => {
  const { data, app } = await mountData({ grandchild: "child", child: "root" })
  try {
    await data.session.refresh("grandchild")
    expect(data.session.root("grandchild")).toBe("child")
    expect(data.session.family("grandchild")).toEqual(["grandchild"])

    await data.session.refresh("child")
    // grandchild's tentative family (keyed by the missing "child") merges up
    // toward the still-missing "root".
    expect(data.session.root("child")).toBe("root")
    expect(data.session.family("grandchild")).toEqual(["grandchild", "child"])

    await data.session.refresh("root")
    expect(data.session.root("grandchild")).toBe("root")
    expect(data.session.root("child")).toBe("root")
    expect(data.session.family("root")).toEqual(["grandchild", "child", "root"])
  } finally {
    app.renderer.destroy()
  }
})

test("totals family cost for roots and keeps subagent cost scoped", async () => {
  const { data, app } = await mountData(
    { grandchild: "child", child: "root" },
    { root: 1, child: 2, grandchild: 3 },
  )
  try {
    await data.session.refresh("grandchild")
    await data.session.refresh("child")
    await data.session.refresh("root")

    expect(data.session.cost("root")).toBe(6)
    expect(data.session.cost("child")).toBe(2)
    expect(data.session.cost("grandchild")).toBe(3)
  } finally {
    app.renderer.destroy()
  }
})

test("re-registering an existing session is idempotent", async () => {
  const { data, app } = await mountData({ grandchild: "child", child: "root" })
  try {
    await data.session.refresh("grandchild")
    await data.session.refresh("child")
    await data.session.refresh("root")
    const before = data.session.family("root")
    expect(before).toEqual(["grandchild", "child", "root"])

    await data.session.refresh("child")
    await data.session.refresh("root")
    await data.session.refresh("grandchild")
    expect(data.session.family("root")).toEqual(before)
    expect(data.session.family("root")).toHaveLength(3)
  } finally {
    app.renderer.destroy()
  }
})

test("stops at the last non-repeating ancestor on a parent cycle", async () => {
  const { data, app } = await mountData({ x: "y", y: "x" })
  try {
    await data.session.refresh("x")
    await data.session.refresh("y")
    // Does not hang; walking up from "y" stops before re-entering "x".
    expect(data.session.root("y")).toBe("x")
    expect(data.session.family("y")).toEqual(["x", "y"])
  } finally {
    app.renderer.destroy()
  }
})
