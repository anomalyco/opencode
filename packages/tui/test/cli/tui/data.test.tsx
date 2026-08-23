/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/event"
import { createEffect, onMount, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider as DataProviderBase, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { Composer } from "../../../src/routes/session/composer"
import { createSessionRows, type SessionRow } from "../../../src/routes/session/rows"
import { createApi, createEventStream, createFetch, directory, json, worktree } from "../../fixture/tui-client"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

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

const config = createTuiResolvedConfig()

function DataProvider(props: ParentProps) {
  return (
    <ConfigProvider config={config}>
      <DataProviderBase>
        <LocationProvider>
          <SyncLocation />
          {props.children}
        </LocationProvider>
      </DataProviderBase>
    </ConfigProvider>
  )
}

function ProjectProvider(props: ParentProps) {
  return props.children
}

function SyncLocation() {
  const data = useData()
  const location = useLocation()
  createEffect(() => location.set(data.location.default()))
  return null
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

test("does not preload session summaries into the data context", async () => {
  const events = createEventStream()
  let location = false
  let sessions = false
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location") location = true
    if (url.pathname === "/api/session") sessions = true
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
    await wait(() => location)
    await Bun.sleep(20)
    expect(sessions).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("syncs VCS info and applies branch updates", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/vcs") return undefined
    return json({
      location: { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } },
      data: { branch: { current: "main", default: "main" } },
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
    await wait(() => data.location.vcs.info()?.branch.current === "main")
    emitEvent(events, {
      id: "evt_vcs_branch",
      created: Date.now(),
      type: "vcs.branch.updated",
      data: { branch: "feature" },
    })
    await wait(() => data.location.vcs.info()?.branch.current === "feature")
    expect(data.location.vcs.info()?.branch).toEqual({ current: "feature", default: "main" })
  } finally {
    app.renderer.destroy()
  }
})

test("proactively syncs project metadata newest first", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/project") return
    return json([
      {
        id: "proj_old",
        canonical: "/old/project",
        name: "Old project",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      },
      {
        id: "proj_test",
        canonical: worktree,
        name: "OpenCode",
        time: { created: 1, updated: 2 },
        sandboxes: [],
      },
    ])
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
    await wait(() => data.project.get("proj_test") !== undefined)
    expect(data.project.list()).toEqual([
      {
        id: "proj_test",
        canonical: worktree,
        name: "OpenCode",
        time: { created: 1, updated: 2 },
        sandboxes: [],
      },
      {
        id: "proj_old",
        canonical: "/old/project",
        name: "Old project",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      },
    ])
  } finally {
    app.renderer.destroy()
  }
})

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
    expect(requests.map((url) => url.searchParams.get("location[directory]"))).toEqual([directory, directory])
  } finally {
    app.renderer.destroy()
  }
})

test("syncs MCP status when a connection settles during bootstrap", async () => {
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
    if (url.pathname === "/api/websearch/provider")
      return json({ location, data: [{ id: "standalone", name: "Standalone" }] })
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

    await data.session.sync("ses_test")
    await data.session.message.sync("ses_test")
    await data.location.agent.sync()
    await data.location.websearch.refresh()

    expect(data.session.get("ses_test")?.title).toBe("Test session")
    expect(data.session.message.list("ses_test").map((message) => message.id)).toEqual(["msg_first", "msg_second"])
    expect(data.session.message.get("ses_test", "msg_second")?.id).toBe("msg_second")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("msg_second")
    expect(data.location.default()).toEqual({ directory, workspaceID: undefined })
    expect(data.location.agent.list(location)?.map((agent) => agent.id)).toEqual(["build"])
    expect(data.location.websearch.list(location)).toEqual([{ id: "standalone", name: "Standalone" }])
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
    await data.session.sync(sessionID)
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
    await data.session.sync(sessionID)
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
    await data.session.sync("ses_test")
    emitEvent(events, {
      id: "evt_moved_1",
      created: 1,
      type: "session.moved",
      durable: durable("ses_test"),
      data: {
        sessionID: "ses_test",
        location: { directory: destination },
        projectID: "project-moved",
        subpath: "packages/cli",
      },
    })
    await wait(() => data.session.get("ses_test")?.location.directory === destination)
    expect(data.session.get("ses_test")?.projectID).toBe("project-moved")
    expect(data.session.get("ses_test")?.subpath).toBe("packages/cli")
    expect(data.session.message.list("ses_test")).toContainEqual({
      id: "msg_moved_1",
      type: "location-switched",
      location: { directory: destination },
      projectID: "project-moved",
      subpath: "packages/cli",
      previous: {
        location: { directory },
        projectID: "proj_test",
      },
      time: { created: 1 },
    })
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
    await data.session.message.sync("session-compaction")
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

test("reconnects the event stream and resyncs active data", async () => {
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
    await data.session.message.sync("session-stale")
    expect(data.session.message.get("session-stale", "message-stale")?.id).toBe("message-stale")
    expect(client.connection.status()).toBe("connected")
    expect(client.connection.attempt()).toBe(0)

    events.disconnect()
    await wait(() => client.connection.status() === "reconnecting")
    expect(client.connection.attempt()).toBe(1)
    expect(client.connection.error()).toBe("Event stream disconnected")

    await wait(() => requests.active === 2 && client.connection.status() === "connected", 4000)
    resolveActive(json({ data: { "session-new": { type: "running" } } }))
    void data.session.message.sync("session-stale")

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
  let client!: ReturnType<typeof useClient>

  function Probe() {
    client = useClient()
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
    await wait(() => client.connection.status() === "connected")
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
        id: "call-read",
        name: "read",
      },
    })
    await wait(() => rows.some((row) => row.type === "group" && !row.completed))

    emitEvent(events, {
      id: "evt_prompt_admitted",
      created: 3,
      type: "session.inbox.enqueued",
      durable: durable(sessionID, 2),
      data: {
        sessionID,
        inboxID: "message-user",
        item: { type: "user", payload: { text: "Continue" }, delivery: "steer" },
      },
    })
    await wait(() => rows.at(-1)?.type === "message")
    expect(rows.find((row) => row.type === "group")?.completed).toBe(false)

    emitEvent(events, {
      id: "evt_prompt_promoted",
      created: 4,
      type: "session.inbox.delivered",
      durable: durable(sessionID, 3),
      data: {
        sessionID,
        inboxID: "message-user",
      },
    })
    await wait(() => rows.find((row) => row.type === "group")?.completed === true)
    expect(rows.at(-1)).toEqual({ type: "message", messageID: "message-user" })
  } finally {
    app.renderer.destroy()
  }
})

test("updates and removes queued inputs from durable lifecycle events", async () => {
  const events = createEventStream()
  const sessionID = "session-queue-management"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
  }, events)
  let data!: ReturnType<typeof useData>
  let rows!: ReturnType<typeof createSessionRows>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    client = useClient()
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
    await wait(() => client.connection.status() === "connected")
    emitEvent(events, {
      id: "evt_queue_admitted",
      created: 1,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID,
        inboxID: "message-queued",
        item: { type: "user", payload: { text: "Steer me" }, delivery: "queue" },
      },
    })
    await wait(() => data.session.pending.list(sessionID).length === 1)
    expect(rows).not.toContainEqual({ type: "message", messageID: "message-queued" })

    emitEvent(events, {
      id: "evt_queue_steered",
      created: 2,
      type: "session.inbox.delivery.changed",
      durable: durable(sessionID, 1),
      data: { sessionID, inboxID: "message-queued", delivery: "steer" },
    })
    await wait(() =>
      data.session.pending
        .list(sessionID)
        .some((item) => item.id === "message-queued" && item.type !== "compaction" && item.delivery === "steer"),
    )
    expect(rows).toContainEqual({ type: "message", messageID: "message-queued" })

    emitEvent(events, {
      id: "evt_queue_restored",
      created: 3,
      type: "session.inbox.delivery.changed",
      durable: durable(sessionID, 2),
      data: { sessionID, inboxID: "message-queued", delivery: "queue" },
    })
    await wait(() =>
      data.session.pending
        .list(sessionID)
        .some((item) => item.id === "message-queued" && item.type !== "compaction" && item.delivery === "queue"),
    )
    expect(rows).not.toContainEqual({ type: "message", messageID: "message-queued" })

    emitEvent(events, {
      id: "evt_cancel_admitted",
      created: 4,
      type: "session.inbox.enqueued",
      durable: durable(sessionID, 3),
      data: {
        sessionID,
        inboxID: "message-cancelled",
        item: { type: "user", payload: { text: "Delete me" }, delivery: "queue" },
      },
    })
    await wait(() => data.session.pending.list(sessionID).length === 2)
    emitEvent(events, {
      id: "evt_queue_cancelled",
      created: 5,
      type: "session.inbox.cancelled",
      durable: durable(sessionID, 4),
      data: { sessionID, inboxID: "message-cancelled" },
    })
    await wait(() => !data.session.input.has(sessionID, "message-cancelled"))
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["message-queued"])
    expect(data.session.message.get(sessionID, "message-cancelled")).toBeUndefined()
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
  let client!: ReturnType<typeof useClient>

  function Probe() {
    client = useClient()
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
    await wait(() => client.connection.status() === "connected")
    emitEvent(events, {
      id: "evt_tool_started",
      created: 1,
      type: "session.tool.input.started",
      durable: durable(sessionID),
      data: {
        sessionID,
        assistantMessageID: "message-assistant",
        id: "reasoning:0",
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
    for (const [seq, inboxID] of ["msg_001", "msg_002", "msg_003"].entries()) {
      emitEvent(events, {
        id: Event.ID.create(),
        created: seq,
        type: "session.inbox.enqueued",
        durable: durable(sessionID, seq),
        data: { sessionID, inboxID, item: { type: "user", payload: { text: inboxID }, delivery: "steer" } },
      })
    }
    await wait(() => data.session.message.list(sessionID).length === 3)

    emitEvent(events, {
      id: Event.ID.create(),
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
    await data.session.sync("session-live")

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

    await data.session.sync("session-failed")
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
      type: "session.inbox.enqueued",
      durable: durable("session-manual", 1),
      data: {
        sessionID: "session-manual",
        inboxID: "message-compaction",
        item: { type: "compaction", payload: {}, delivery: "queue" },
      },
    })
    await wait(() => data.session.pending.list("session-manual").some((item) => item.id === "message-compaction"))
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
    expect(data.session.pending.list("session-manual")).toEqual([])
    const compactionRow = manualRows.find((row) => row.type === "message" && row.messageID === "message-compaction")
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
    const autoCompactionRow = rows.find((row) => row.type === "message" && row.messageID === "msg_compaction_started")

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
      id: "message-compaction-queued",
      sessionID,
      timeCreated: 1,
      type: "compaction" as const,
      payload: {},
      delivery: "queue" as const,
    },
    {
      id: "message-compaction-later",
      sessionID,
      timeCreated: 2,
      type: "compaction" as const,
      payload: {},
      delivery: "queue" as const,
    },
  ]
  const calls = createFetch((url) => {
    if (url.pathname !== `/api/session/${sessionID}/inbox`) return
    return json({ data: pending })
  }, events)
  let data!: ReturnType<typeof useData>
  let rows!: ReturnType<typeof createSessionRows>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    data = useData()
    client = useClient()
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
    await wait(() => client.connection.status() === "connected")
    await wait(() => data.session.pending.list(sessionID).length === 2)
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual([
      "message-compaction-queued",
      "message-compaction-later",
    ])
    await wait(() => rows.filter((row) => row.type === "compaction-queued").length === 2)
    expect(rows.filter((row) => row.type === "compaction-queued")).toEqual([
      { type: "compaction-queued", inboxID: "message-compaction-queued" },
      { type: "compaction-queued", inboxID: "message-compaction-later" },
    ])

    emitEvent(events, {
      id: "evt_step_started",
      created: 2,
      type: "session.step.started",
      durable: durable(sessionID, 3),
      data: {
        sessionID,
        assistantMessageID: "message-assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    emitEvent(events, {
      id: "evt_text_started",
      created: 2,
      type: "session.text.started",
      durable: durable(sessionID, 4),
      data: {
        sessionID,
        assistantMessageID: "message-assistant",
        ordinal: 0,
      },
    })
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
      durable: durable(sessionID, 6),
      data: {
        sessionID,
        reason: "manual",
        recent: "",
        inputID: "message-compaction-queued",
      },
    })
    await wait(() => data.session.pending.list(sessionID).length === 1)
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["message-compaction-later"])

    emitEvent(events, {
      id: "evt_compaction_ended",
      created: 3,
      type: "session.compaction.ended",
      durable: durable(sessionID, 7),
      data: { sessionID, reason: "manual", text: "Summary", recent: "" },
    })
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["message-compaction-later"])

    pending = []
    data.session.pending.invalidate(sessionID)
    await data.session.pending.sync(sessionID)
    await wait(() => data.session.pending.list(sessionID).length === 0)
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
  const workspace = "ws_other"
  let removed: URL | undefined
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/shell/sh_other" && request.method === "DELETE") {
      removed = url
      return new Response(null, { status: 204 })
    }
    if (url.pathname !== "/api/shell") return
    const requestDirectory = url.searchParams.get("location[directory]")
    return json({
      location: {
        directory: requestDirectory ?? directory,
        workspaceID: url.searchParams.get("location[workspace]") ?? undefined,
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
          metadata: { sessionID: "ses_shared" },
          time: { started: 1 },
        },
      ],
    })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return (
      <RouteProvider initialRoute={{ type: "session", sessionID: "ses_shared" }}>
        <Keymap.Provider>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Composer sessionID="ses_shared" open={true} defaultTab="shell" />
          </ThemeProvider>
        </Keymap.Provider>
      </RouteProvider>
    )
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
  app.renderer.start()

  try {
    await wait(() => data.shell.list().some((shell) => shell.id === "sh_default"))
    await data.shell.sync({ directory: other, workspaceID: workspace })

    expect(data.shell.list().map((shell) => shell.id)).toEqual(["sh_default"])
    expect(data.shell.list({ directory: other, workspaceID: workspace }).map((shell) => shell.id)).toEqual(["sh_other"])
    expect(data.shell.listBySession("ses_shared").map((shell) => [shell.id, shell.location.directory])).toEqual([
      ["sh_default", directory],
      ["sh_other", other],
    ])

    await app.waitForFrame((frame) => frame.includes("pnpm dev"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressKey("d", { ctrl: true })
    await wait(() => removed !== undefined)
    expect(removed?.searchParams.get("location[directory]")).toBe(other)
    expect(removed?.searchParams.get("location[workspace]")).toBe(workspace)

    events.emit({
      id: "evt_shell_created",
      created: 0,
      type: "shell.created",
      location: { directory: other, workspaceID: workspace },
      data: {
        info: {
          id: "sh_live_other",
          status: "running",
          command: "npm run watch",
          cwd: other,
          shell: "/bin/sh",
          file: "/tmp/opencode-shell-live",
          metadata: { sessionID: "ses_shared" },
          time: { started: 2 },
        },
      },
    })
    await wait(() =>
      data.shell.list({ directory: other, workspaceID: workspace }).some((shell) => shell.id === "sh_live_other"),
    )
    expect(data.shell.list().map((shell) => shell.id)).toEqual(["sh_default"])
    expect(
      data.shell.listBySession("ses_shared").find((shell) => shell.id === "sh_live_other")?.location.directory,
    ).toBe(other)
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
      type: "permission.asked",
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
      type: "permission.asked",
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
      type: "permission.replied",
      data: { sessionID: "ses_1", requestID: "per_1", reply: "once" },
    })
    await wait(() => data.session.permission.list("ses_1")?.length === 1)
    expect(data.session.permission.list("ses_1")?.[0]?.id).toBe("per_2")

    emitEvent(events, {
      id: "evt_permission_replied_2",
      created: 0,
      type: "permission.replied",
      data: { sessionID: "ses_1", requestID: "per_2", reply: "reject" },
    })
    await wait(() => data.session.permission.list("ses_1")?.length === 0)
  } finally {
    app.renderer.destroy()
  }
})

test("reconciles active session permissions when the event stream reconnects", async () => {
  const events = createEventStream()
  let requests = [
    { id: "per_old", sessionID: "ses_active", action: "read", resources: ["old.txt"] },
    { id: "per_keep", sessionID: "ses_active", action: "shell", resources: ["bun test"] },
  ]
  let calls = 0
  const fetch = createFetch((url) => {
    if (url.pathname !== "/api/session/ses_active/permission") return
    calls++
    return json({ data: requests })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    const client = useClient()
    createEffect(() => {
      if (client.connection.status() !== "connected") return
      void data.session.permission.sync("ses_active")
    })
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
    await wait(() => data.session.permission.list("ses_active")?.length === 2)

    requests = [{ id: "per_new", sessionID: "ses_active", action: "edit", resources: ["new.txt"] }]
    events.disconnect()

    await wait(() => calls === 2 && data.session.permission.list("ses_active")?.[0]?.id === "per_new")
  } finally {
    app.renderer.destroy()
  }
})

test("dismisses a permission that expired before its reply", async () => {
  const events = createEventStream()
  const request = { id: "per_stale", sessionID: "ses_active", action: "read", resources: ["old.txt"] }
  let replies = 0
  const calls = createFetch((url, init) => {
    if (url.pathname === "/api/session/ses_active/permission/per_stale/reply" && init.method === "POST") {
      replies++
      return json(
        {
          _tag: "PermissionNotFoundError",
          requestID: request.id,
          message: `Permission request not found: ${request.id}`,
        },
        { status: 404 },
      )
    }
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
    emitEvent(events, {
      id: "evt_permission_asked_stale",
      created: 0,
      type: "permission.asked",
      data: request,
    })
    await wait(() => data.session.permission.list(request.sessionID)?.length === 1)

    await data.session.permission.reply({
      sessionID: request.sessionID,
      requestID: request.id,
      reply: "once",
    })

    expect(replies).toBe(1)
    expect(data.session.permission.list(request.sessionID)).toEqual([])
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

    await data.session.form.sync("ses_1")
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

test("syncs global forms once for each requested location", async () => {
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

    await data.session.form.sync("global", { directory })
    await data.session.form.sync("global", other)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.searchParams.get("location[directory]")).toBe(other.directory)
    expect(requests[0]?.searchParams.get("location[workspace]")).toBe(other.workspaceID)
    expect(data.session.form.list("global", other)?.map((form) => form.id)).toEqual(["frm_other"])
    expect(data.session.form.list("global", { directory })?.map((form) => form.id)).toEqual(["frm_default"])

    data.session.form.invalidate("global", other)
    await data.session.form.sync("global", other)
    expect(requests).toHaveLength(2)
  } finally {
    app.renderer.destroy()
  }
})

test("resyncs global forms only for the active location after reconnect", async () => {
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
    await wait(() => data.session.form.list("global", home)?.[0]?.id === "frm_default_1")
    await data.session.form.sync("global", other)
    expect(data.session.form.list("global", other)?.[0]?.id).toBe("frm_other_1")
    expect(requests).toHaveLength(2)
    requests.length = 0

    events.disconnect()

    await wait(() => data.session.form.list("global", home)?.[0]?.id === "frm_default_2", 4000)
    expect(data.session.form.list("global", other)?.[0]?.id).toBe("frm_other_1")
    expect(requests).toHaveLength(1)
    expect(
      requests.map((url) => [
        url.searchParams.get("location[directory]") ?? directory,
        url.searchParams.get("location[workspace]") ?? undefined,
      ]),
    ).toEqual([[home.directory, undefined]])
  } finally {
    app.renderer.destroy()
  }
})

test("reconciles active session forms when the event stream reconnects", async () => {
  const events = createEventStream()
  let requests = [
    { id: "frm_old", sessionID: "ses_active", title: "Input requested", fields: formFields },
    {
      id: "frm_keep",
      sessionID: "ses_active",
      title: "Input requested",
      fields: [{ key: "authorization", type: "external" as const, url: "https://example.com" }],
    },
  ]
  let calls = 0
  const fetch = createFetch((url) => {
    if (url.pathname !== "/api/session/ses_active/form") return
    calls++
    return json({ data: requests })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    const client = useClient()
    createEffect(() => {
      if (client.connection.status() !== "connected") return
      void data.session.form.sync("ses_active")
    })
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
    await wait(() => data.session.form.list("ses_active")?.length === 2)

    requests = [{ id: "frm_new", sessionID: "ses_active", title: "Input requested", fields: formFields }]
    events.disconnect()

    await wait(() => calls === 2 && data.session.form.list("ses_active")?.[0]?.id === "frm_new")
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
        id: "call-1",
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
        id: "call-1",
        input: {},
        executed: false,
        state: { call: true },
      },
    })
    emitEvent(events, {
      id: "evt_progress_1",
      created: 0,
      type: "session.tool.progress",
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        id: "call-1",
        metadata: { sessionID: "session-child", status: "running" },
      },
    })

    await wait(() => {
      const assistant = sync.session.message.get("session-1", "msg_explicit_assistant_9")
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "running" &&
        assistant.content[0].state.metadata.sessionID === "session-child"
      )
    })

    emitEvent(events, {
      id: "evt_failed_1",
      created: 0,
      type: "session.tool.failed",
      durable: durable("session-1", 6, 2),
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        id: "call-1",
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
    expect(tool.state.metadata).toBeUndefined()
    expect(tool.state.content).toBeUndefined()
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
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID,
        inboxID: messageID,
        item: { type: "user", payload: { text: "hello" }, delivery: "steer" },
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
        timeCreated: 0,
        type: "user",
        payload: { text: "hello" },
        delivery: "steer",
      },
    ])
    expect(sync.session.input.list(sessionID)).toEqual([messageID])

    await sync.session.message.sync(sessionID)
    expect(sync.session.message.list(sessionID)?.[0]?.metadata).toBeUndefined()

    emitEvent(events, {
      id: "evt_prompted_1",
      created: 0,
      type: "session.inbox.delivered",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        inboxID: messageID,
      },
    })

    await wait(() => received.at(-1) === "session.inbox.delivered")
    expect(received.slice(-2)).toEqual(["session.inbox.enqueued", "session.inbox.delivered"])
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
    emitEvent(events, {
      id: "evt_instructions_3",
      created: 2,
      type: "session.instructions.updated",
      durable: durable("session-1", 2, 2),
      data: {
        sessionID: "session-1",
        delta: { "core/date": "2".repeat(64) },
        text: "The current date has changed.",
      },
    })

    await wait(() => sync.session.message.list("session-1")?.some((message) => message.time.created === 2))
    expect(sync.session.message.list("session-1")).toHaveLength(1)
    expect(sync.session.message.list("session-1")?.[0]).toMatchObject({
      id: SessionMessage.ID.fromEvent(Event.ID.make("evt_instructions_3")),
      type: "system",
      text: "The current date has changed.",
      description: "Instructions updated: core/date",
      time: { created: 2 },
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
    if (url.pathname === "/api/session") {
      const parentID = url.searchParams.get("parentID")
      return json({
        data: Object.entries(parents)
          .filter(([, parent]) => parent === parentID)
          .map(([id, parent]) => sessionInfo(id, parent, costs[id])),
        cursor: {},
      })
    }
    const match = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (match && match[1] !== "active") return json({ data: sessionInfo(match[1], parents[match[1]], costs[match[1]]) })
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

test("syncs direct child session info with a navigated root", async () => {
  const { data, app } = await mountData({ child: "root", sibling: "root", grandchild: "child" })
  try {
    await data.session.sync("root", { children: true })
    expect(data.session.get("root")?.id).toBe("root")
    expect(data.session.get("child")?.parentID).toBe("root")
    expect(data.session.get("sibling")?.parentID).toBe("root")
    expect(data.session.get("grandchild")).toBeUndefined()
    expect(data.session.family("root")).toEqual(["root", "child", "sibling"])
  } finally {
    app.renderer.destroy()
  }
})

test("groups an orphan child under its missing parent until the root arrives", async () => {
  const { data, app } = await mountData({ child: "root" })
  try {
    await data.session.sync("child")
    // Parent info is absent, so the missing parent is the furthest-known ancestor.
    expect(data.session.root("child")).toBe("root")
    expect(data.session.family("child")).toEqual(["child"])
    expect(data.session.family("root")).toEqual(["child"])

    await data.session.sync("root")
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
    await data.session.sync("grandchild")
    expect(data.session.root("grandchild")).toBe("child")
    expect(data.session.family("grandchild")).toEqual(["grandchild"])

    await data.session.sync("child")
    // grandchild's tentative family (keyed by the missing "child") merges up
    // toward the still-missing "root".
    expect(data.session.root("child")).toBe("root")
    expect(data.session.family("grandchild")).toEqual(["grandchild", "child"])

    await data.session.sync("root")
    expect(data.session.root("grandchild")).toBe("root")
    expect(data.session.root("child")).toBe("root")
    expect(data.session.family("root")).toEqual(["grandchild", "child", "root"])
  } finally {
    app.renderer.destroy()
  }
})

test("totals family cost for roots and keeps subagent cost scoped", async () => {
  const { data, app } = await mountData({ grandchild: "child", child: "root" }, { root: 1, child: 2, grandchild: 3 })
  try {
    await data.session.sync("grandchild")
    await data.session.sync("child")
    await data.session.sync("root")

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
    await data.session.sync("grandchild")
    await data.session.sync("child")
    await data.session.sync("root")
    const before = data.session.family("root")
    expect(before).toEqual(["grandchild", "child", "root"])

    await data.session.sync("child")
    await data.session.sync("root")
    await data.session.sync("grandchild")
    expect(data.session.family("root")).toEqual(before)
    expect(data.session.family("root")).toHaveLength(3)
  } finally {
    app.renderer.destroy()
  }
})

test("stops at the last non-repeating ancestor on a parent cycle", async () => {
  const { data, app } = await mountData({ x: "y", y: "x" })
  try {
    await data.session.sync("x")
    await data.session.sync("y")
    // Does not hang; walking up from "y" stops before re-entering "x".
    expect(data.session.root("y")).toBe("x")
    expect(data.session.family("y")).toEqual(["x", "y"])
  } finally {
    app.renderer.destroy()
  }
})

test("admits prompts optimistically and reconciles with the durable echo", async () => {
  const events = createEventStream()
  const sessionID = "session-1"
  let release!: (response: Response) => void
  const deferred = new Promise<Response>((resolve) => {
    release = resolve
  })
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/prompt`) return deferred
    // The server does not know about the in-flight admission yet.
    if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
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
    const promise = sync.session.prompt({ sessionID, text: "hello" })
    const settled = promise.then(
      () => undefined,
      (error) => error,
    )

    // Optimistic: the row renders before the server responds.
    const optimistic = sync.session.pending.list(sessionID)[0]
    expect(optimistic).toMatchObject({ sessionID, type: "user", payload: { text: "hello" }, delivery: "steer" })
    const messageID = optimistic!.id
    expect(messageID.startsWith("msg_")).toBe(true)
    expect(sync.session.input.list(sessionID)).toEqual([messageID])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])

    // A pending re-fetch racing the in-flight admission cannot wipe the row.
    await sync.session.pending.sync(sessionID)
    expect(sync.session.pending.list(sessionID).map((item) => item.id)).toEqual([messageID])
    expect(sync.session.input.list(sessionID)).toEqual([messageID])

    // The durable echo upserts by ID instead of duplicating: server-loaded
    // payload (files) and durable times replace the optimistic placeholder.
    const received: string[] = []
    const unsubscribe = sync.listen((event) => received.push(event.name))
    const echoFile = { data: "aGVsbG8=", mime: "text/plain", source: { type: "uri" as const, uri: "file:///a.txt" } }
    emitEvent(events, {
      id: "evt_echo_1",
      created: 5,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID,
        inboxID: messageID,
        item: { type: "user", payload: { text: "hello", files: [echoFile] }, delivery: "steer" },
      },
    })
    await wait(() => received.includes("session.inbox.enqueued"))
    unsubscribe()
    expect(sync.session.pending.list(sessionID)).toEqual([
      {
        id: messageID,
        sessionID,
        timeCreated: 5,
        type: "user",
        payload: { text: "hello", files: [echoFile] },
        delivery: "steer",
      },
    ])
    const echoed = sync.session.message.list(sessionID)[0]
    expect(echoed?.type).toBe("user")
    if (echoed?.type !== "user") return
    expect(echoed.time.created).toBe(5)
    expect(echoed.files).toEqual([echoFile])

    // A late transport failure after the echo must not delete acknowledged state.
    release(json({ _tag: "UnknownError", message: "response lost" }, { status: 500 }))
    expect(await settled).toBeDefined()
    expect(sync.session.pending.list(sessionID).map((item) => item.id)).toEqual([messageID])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])
  } finally {
    release(json({ _tag: "UnknownError", message: "cleanup" }, { status: 500 }))
    app.renderer.destroy()
  }
})

test("hydrates durable pending prompts into the visible transcript", async () => {
  const sessionID = "session-1"
  const item = {
    id: "msg_pending_1",
    sessionID,
    timeCreated: 5,
    type: "user" as const,
    payload: { text: "waiting" },
    delivery: "steer" as const,
  }
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [item] })
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
  })
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
    await sync.session.pending.sync(sessionID)
    expect(sync.session.message.list(sessionID)).toEqual([
      { id: item.id, type: "user", text: "waiting", time: { created: 5 } },
    ])

    await sync.session.message.sync(sessionID)
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([item.id])
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the row when the response lands before the echo", async () => {
  const events = createEventStream()
  const sessionID = "session-1"
  const messageID = "msg_early_1"
  const admission = {
    id: messageID,
    sessionID,
    timeCreated: 1,
    type: "user",
    payload: { text: "hello" },
    delivery: "steer",
  }
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/prompt`) return json({ data: admission })
    // The server's listings still miss the admission (projection lag).
    if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
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
    await sync.session.prompt({ sessionID, id: messageID, text: "hello" })

    // POST resolved but the echo has not arrived: racing pending and message
    // re-fetches still cannot wipe the row.
    await sync.session.pending.sync(sessionID)
    sync.session.pending.invalidate(sessionID)
    await sync.session.pending.sync(sessionID)
    await sync.session.message.sync(sessionID)
    sync.session.message.invalidate(sessionID)
    await sync.session.message.sync(sessionID)
    expect(sync.session.pending.list(sessionID).map((item) => item.id)).toEqual([messageID])
    expect(sync.session.input.list(sessionID)).toEqual([messageID])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])
  } finally {
    app.renderer.destroy()
  }
})

test("rolls back an optimistic prompt the server rejected", async () => {
  const events = createEventStream()
  const sessionID = "session-1"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/prompt`)
      return json({ _tag: "InvalidRequestError", message: "invalid" }, { status: 400 })
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
    const promise = sync.session.prompt({ sessionID, text: "rejected" })
    expect(sync.session.message.list(sessionID)).toHaveLength(1)

    await expect(promise).rejects.toThrow()
    expect(sync.session.pending.list(sessionID)).toEqual([])
    expect(sync.session.input.list(sessionID)).toEqual([])
    expect(sync.session.message.list(sessionID)).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("a retry under the same client-minted ID cannot duplicate rows", async () => {
  const events = createEventStream()
  const sessionID = "session-1"
  const messageID = "msg_retry_1"
  const admission = {
    id: messageID,
    sessionID,
    timeCreated: 1,
    type: "user",
    payload: { text: "hello" },
    delivery: "steer",
  }
  const posts: string[] = []
  let fail = false
  const calls = createFetch(async (url, request) => {
    if (url.pathname === `/api/session/${sessionID}/prompt`) {
      posts.push(((await request.json()) as { id: string }).id)
      if (fail) return json({ _tag: "UnknownError", message: "transient" }, { status: 500 })
      return json({ data: admission })
    }
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
    await sync.session.prompt({ sessionID, id: messageID, text: "hello" })
    // Retry with the identical payload: server admission is idempotent per ID,
    // and the local dedupe keeps a single row.
    await sync.session.prompt({ sessionID, id: messageID, text: "hello" })

    expect(posts).toEqual([messageID, messageID])
    expect(sync.session.pending.list(sessionID).map((item) => item.id)).toEqual([messageID])
    expect(sync.session.input.list(sessionID)).toEqual([messageID])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])

    // The row is acknowledged (echo applied): a FAILED retry under the same
    // ID must not roll back acknowledged state.
    const received: string[] = []
    const unsubscribe = sync.listen((event) => received.push(event.name))
    emitEvent(events, {
      id: "evt_ack_1",
      created: 2,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: { sessionID, inboxID: messageID, item: { type: "user", payload: { text: "hello" }, delivery: "steer" } },
    })
    await wait(() => received.includes("session.inbox.enqueued"))
    unsubscribe()
    fail = true
    await expect(sync.session.prompt({ sessionID, id: messageID, text: "hello" })).rejects.toThrow()
    expect(sync.session.pending.list(sessionID).map((item) => item.id)).toEqual([messageID])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])
  } finally {
    app.renderer.destroy()
  }
})
