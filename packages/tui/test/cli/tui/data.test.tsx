import { Integration } from "@opencode/schema/integration"
import { Credential } from "@opencode/schema/credential"
import { Model } from "@opencode/schema/model"
import { WebSearch } from "@opencode/schema/websearch"
import { Provider } from "@opencode/schema/provider"
import { Agent } from "@opencode/schema/agent"
import { Form } from "@opencode/schema/form"
import { Permission } from "@opencode/schema/permission"
import { Shell } from "@opencode/schema/shell"
import { Session } from "@opencode/schema/session"
import { Project } from "@opencode/schema/project"
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { OpenCodeEvent } from "@opencode/client"
import { SessionMessage } from "@opencode/core/session/message"
import { Event } from "@opencode/schema/event"
import { Expected } from "../../../../core/test/lib/session-message"
import { createEffect, onMount, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider as DataProviderBase, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { RouteProvider } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { Composer } from "../../../src/routes/session/composer"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createSessionRows, type SessionRow } from "../../../src/routes/session/rows"
import { groupRefs } from "../../../src/routes/session/grouping/session"
import { unwrap } from "solid-js/store"
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
      <DataProviderBase directory={process.cwd()}>
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
      id: Event.ID.make("evt_vcs_branch", { disableChecks: true }),
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

test("proactively syncs project metadata most recently active first", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/project") return
    return json([
      {
        id: "proj_old",
        canonical: "/old/project",
        name: "Old project",
        time: { created: 1, updated: 1, active: 3 },
        sandboxes: [],
      },
      {
        id: "proj_test",
        canonical: worktree,
        name: "OpenCode",
        time: { created: 1, updated: 2, active: 2 },
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
    await wait(() => data.project.get(Project.ID.make("proj_test", { disableChecks: true })) !== undefined)
    expect(data.project.list()).toEqual([
      {
        id: Project.ID.make("proj_old", { disableChecks: true }),
        canonical: "/old/project",
        name: "Old project",
        time: { created: 1, updated: 1, active: 3 },
        sandboxes: [],
      },
      {
        id: Project.ID.make("proj_test", { disableChecks: true }),
        canonical: worktree,
        name: "OpenCode",
        time: { created: 1, updated: 2, active: 2 },
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
      id: Event.ID.make("evt_mcp_connected", { disableChecks: true }),
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
          id: Session.ID.make("ses_test", { disableChecks: true }),
          projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
          {
            id: SessionMessage.ID.make("msg_second", { disableChecks: true }),
            created: 0,
            type: "user",
            text: "Second",
            time: { created: 2 },
          },
          {
            id: SessionMessage.ID.make("msg_first", { disableChecks: true }),
            created: 0,
            type: "user",
            text: "First",
            time: { created: 1 },
          },
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
    return (
      <text>
        {data.session.message.get(
          Session.ID.make("ses_test", { disableChecks: true }),
          SessionMessage.ID.make("msg_second", { disableChecks: true }),
        )?.id ?? "missing"}
      </text>
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

  try {
    await mounted
    expect(data.location.default()).toEqual({ directory: process.cwd() })
    expect(data.session.get(Session.ID.make("ses_test", { disableChecks: true }))).toBeUndefined()
    expect(data.location.agent.list(location)).toBeUndefined()

    await data.session.sync(Session.ID.make("ses_test", { disableChecks: true }))
    await data.session.message.sync(Session.ID.make("ses_test", { disableChecks: true }))
    await data.location.agent.sync()
    await data.location.websearch.refresh()

    expect(data.session.get(Session.ID.make("ses_test", { disableChecks: true }))?.title).toBe("Test session")
    expect(
      data.session.message.list(Session.ID.make("ses_test", { disableChecks: true })).map((message) => message.id),
    ).toEqual([
      SessionMessage.ID.make("msg_first", { disableChecks: true }),
      SessionMessage.ID.make("msg_second", { disableChecks: true }),
    ])
    expect(
      data.session.message.get(
        Session.ID.make("ses_test", { disableChecks: true }),
        SessionMessage.ID.make("msg_second", { disableChecks: true }),
      )?.id,
    ).toBe(SessionMessage.ID.make("msg_second", { disableChecks: true }))
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("msg_second")
    expect(data.location.default()).toEqual({ directory, workspaceID: undefined })
    expect(data.location.agent.list(location)?.map((agent) => agent.id)).toEqual([
      Agent.ID.make("build", { disableChecks: true }),
    ])
    expect(data.location.websearch.list(location)).toEqual([
      { id: WebSearch.ID.make("standalone", { disableChecks: true }), name: "Standalone" },
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("applies absolute usage events to session info", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("ses_usage_refresh", { disableChecks: true })
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
      id: Event.ID.make("evt_usage_2", { disableChecks: true }),
      created: 2,
      type: "session.usage.updated",
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
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
      id: Event.ID.make("evt_usage_3", { disableChecks: true }),
      created: 3,
      type: "session.usage.updated",
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        cost: 1,
        tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 1, write: 1 } },
      },
    })
    await wait(() => data.session.get(sessionID)?.cost === 1)
    expect(data.session.get(sessionID)?.title).toBe("Usage")

    emitEvent(events, {
      id: Event.ID.make("evt_usage_deleted", { disableChecks: true }),
      created: 9,
      type: "session.deleted",
      durable: durable(sessionID, 9, 2),
      data: { sessionID: Session.ID.make(sessionID, { disableChecks: true }) },
    })
    await wait(() => data.session.get(sessionID) === undefined)
  } finally {
    app.renderer.destroy()
  }
})

test("truncates committed revert messages without changing lifetime usage", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("ses_revert_usage", { disableChecks: true })
  let cost = 0
  let tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
    if (url.pathname !== `/api/session/${sessionID}`) return
    return json({
      data: {
        id: sessionID,
        projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
      id: Event.ID.make("evt_revert_boundary_started", { disableChecks: true }),
      created: 1,
      type: "session.step.started",
      durable: durable(sessionID, 1),
      data: {
        started: 1,
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_revert_boundary", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          id: Model.ID.make("model", { disableChecks: true }),
        },
      },
    })
    cost = 0.5
    tokens = { input: 5, output: 2, reasoning: 1, cache: { read: 1, write: 1 } }
    emitEvent(events, {
      id: Event.ID.make("evt_revert_boundary_ended", { disableChecks: true }),
      created: 2,
      type: "session.step.ended",
      durable: durable(sessionID, 2),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_revert_boundary", { disableChecks: true }),
        finish: "stop",
        cost: 0.5,
        tokens,
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_revert_boundary_usage", { disableChecks: true }),
      created: 2,
      type: "session.usage.updated",
      data: { sessionID: Session.ID.make(sessionID, { disableChecks: true }), cost, tokens },
    })
    await wait(() => data.session.get(sessionID)?.cost === 0.5)

    emitEvent(events, {
      id: Event.ID.make("evt_revert_later_started", { disableChecks: true }),
      created: 3,
      type: "session.step.started",
      durable: durable(sessionID, 3),
      data: {
        started: 3,
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_revert_later", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          id: Model.ID.make("model", { disableChecks: true }),
        },
      },
    })
    cost = 0.75
    tokens = { input: 8, output: 3, reasoning: 1, cache: { read: 1, write: 1 } }
    emitEvent(events, {
      id: Event.ID.make("evt_revert_later_ended", { disableChecks: true }),
      created: 4,
      type: "session.step.ended",
      durable: durable(sessionID, 4),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_revert_later", { disableChecks: true }),
        finish: "stop",
        cost: 0.25,
        tokens: { input: 3, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_revert_later_usage", { disableChecks: true }),
      created: 4,
      type: "session.usage.updated",
      data: { sessionID: Session.ID.make(sessionID, { disableChecks: true }), cost, tokens },
    })
    await wait(() => data.session.get(sessionID)?.cost === 0.75)
    emitEvent(events, {
      id: Event.ID.make("evt_revert_staged", { disableChecks: true }),
      created: 5,
      type: "session.revert.staged",
      durable: durable(sessionID, 5),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        revert: { messageID: SessionMessage.ID.make("msg_revert_later", { disableChecks: true }) },
      },
    })
    await wait(
      () =>
        data.session.get(sessionID)?.revert?.messageID ===
        SessionMessage.ID.make("msg_revert_later", { disableChecks: true }),
    )

    emitEvent(events, {
      id: Event.ID.make("evt_revert_committed", { disableChecks: true }),
      created: 6,
      type: "session.revert.committed",
      durable: durable(sessionID, 6),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        to: SessionMessage.ID.make("msg_revert_later", { disableChecks: true }),
      },
    })
    await wait(() => data.session.message.list(sessionID).length === 1)
    expect(data.session.get(sessionID)?.cost).toBe(0.75)
    expect(data.session.message.list(sessionID).map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_revert_boundary", { disableChecks: true }),
    ])
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
          id: Session.ID.make("ses_test", { disableChecks: true }),
          projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
    await data.session.sync(Session.ID.make("ses_test", { disableChecks: true }))
    emitEvent(events, {
      id: Event.ID.make("evt_moved_1", { disableChecks: true }),
      created: 1,
      type: "session.moved",
      durable: durable(Session.ID.make("ses_test", { disableChecks: true })),
      data: {
        sessionID: Session.ID.make("ses_test", { disableChecks: true }),
        location: { directory: destination },
        projectID: Project.ID.make("project-moved", { disableChecks: true }),
        subpath: "packages/cli",
      },
    })
    await wait(
      () => data.session.get(Session.ID.make("ses_test", { disableChecks: true }))?.location.directory === destination,
    )
    expect(data.session.get(Session.ID.make("ses_test", { disableChecks: true }))?.projectID).toBe(
      Project.ID.make("project-moved", { disableChecks: true }),
    )
    expect(data.session.get(Session.ID.make("ses_test", { disableChecks: true }))?.subpath).toBe("packages/cli")
    expect(data.session.message.list(Session.ID.make("ses_test", { disableChecks: true }))).toContainEqual({
      id: SessionMessage.ID.make("msg_moved_1", { disableChecks: true }),
      type: "location-switched",
      location: { directory: destination },
      projectID: Project.ID.make("project-moved", { disableChecks: true }),
      subpath: "packages/cli",
      previous: {
        location: { directory },
        projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
    await data.session.message.sync(Session.ID.make("session-compaction", { disableChecks: true }))
    expect(
      data.session.message.get(
        Session.ID.make("session-compaction", { disableChecks: true }),
        SessionMessage.ID.make("message-compaction", { disableChecks: true }),
      ),
    ).toMatchObject({
      type: "compaction",
      status: "running",
      summary: "Existing ",
    })

    emitEvent(events, {
      id: Event.ID.make("evt_compaction_delta", { disableChecks: true }),
      created: 2,
      type: "session.compaction.delta",
      data: { sessionID: Session.ID.make("session-compaction", { disableChecks: true }), text: "summary" },
    })

    await wait(() => {
      const message = data.session.message.get(
        Session.ID.make("session-compaction", { disableChecks: true }),
        SessionMessage.ID.make("message-compaction", { disableChecks: true }),
      )
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
          providerID: Provider.ID.make("provider", { disableChecks: true }),
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
    await wait(() => data.session.status(Session.ID.make("session-stale", { disableChecks: true })) === "running")
    await data.session.message.sync(Session.ID.make("session-stale", { disableChecks: true }))
    expect(
      data.session.message.get(
        Session.ID.make("session-stale", { disableChecks: true }),
        SessionMessage.ID.make("message-stale", { disableChecks: true }),
      )?.id,
    ).toBe(SessionMessage.ID.make("message-stale", { disableChecks: true }))
    expect(client.connection.status()).toBe("connected")
    expect(client.connection.attempt()).toBe(0)

    events.disconnect()
    await wait(() => client.connection.status() === "reconnecting")
    expect(client.connection.attempt()).toBe(1)
    expect(client.connection.error()).toBe("Event stream disconnected")

    await wait(() => requests.active === 2 && client.connection.status() === "connected", 4000)
    resolveActive(json({ data: { "session-new": { type: "running" } } }))
    void data.session.message.sync(Session.ID.make("session-stale", { disableChecks: true }))

    await wait(() => data.location.model.list()?.[0]?.id === "model-2", 4000)
    await wait(() => data.session.status(Session.ID.make("session-stale", { disableChecks: true })) === "idle")
    await wait(() => requests.message === 2)
    expect(
      data.session.message.get(
        Session.ID.make("session-stale", { disableChecks: true }),
        SessionMessage.ID.make("message-stale", { disableChecks: true }),
      )?.id,
    ).toBe(SessionMessage.ID.make("message-stale", { disableChecks: true }))
    resolveMessages(
      json({
        data: [{ id: "message-fresh", type: "user", text: "Fresh", time: { created: 2 } }],
        cursor: {},
      }),
    )
    await wait(
      () =>
        data.session.message.get(
          Session.ID.make("session-stale", { disableChecks: true }),
          SessionMessage.ID.make("message-fresh", { disableChecks: true }),
        ) !== undefined,
    )
    expect(
      data.session.message.get(
        Session.ID.make("session-stale", { disableChecks: true }),
        SessionMessage.ID.make("message-stale", { disableChecks: true }),
      ),
    ).toBeUndefined()
    await wait(() => data.session.status(Session.ID.make("session-new", { disableChecks: true })) === "running")
    expect(requests.event).toBe(2)
    expect(requests.message).toBe(2)
    expect(client.connection.status()).toBe("connected")
    expect(client.connection.attempt()).toBe(0)
    expect(client.connection.error()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("completes exploration and keeps live rows when a queued prompt is promoted", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-promotion", { disableChecks: true })
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
  }, events)
  let rows!: ReturnType<typeof createSessionRows>
  let client!: ReturnType<typeof useClient>
  let data!: ReturnType<typeof useData>
  let synced = false

  function Probe() {
    client = useClient()
    data = useData()
    rows = createSessionRows(
      () => sessionID,
      () => (synced = true),
    )
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
    // Rebuilds from the history sync and the new assistant message must land before the parts stream in,
    // as they do live; otherwise those rebuilds, not the live append, create the part rows.
    await wait(() => synced)
    emitEvent(events, {
      id: Event.ID.make("evt_step_started", { disableChecks: true }),
      created: 1,
      type: "session.step.started",
      durable: durable(sessionID),
      data: {
        started: 1,
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
      },
    })
    await wait(
      () => data.session.message.get(sessionID, SessionMessage.ID.make("message-assistant", { disableChecks: true })) !== undefined,
    )
    emitEvent(events, {
      id: Event.ID.make("evt_text_started", { disableChecks: true }),
      created: 1,
      type: "session.text.started",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        ordinal: 0,
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_text_delta", { disableChecks: true }),
      created: 1,
      type: "session.text.delta",
      data: {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        ordinal: 0,
        delta: "Looking",
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_tool_started", { disableChecks: true }),
      created: 2,
      type: "session.tool.input.started",
      durable: durable(sessionID, 2),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        id: "call-read",
        name: "read",
      },
    })
    await wait(() => rows.some((row) => row.type === "group" && !row.completed))
    const text = rows.find((row) => row.type === "part")

    emitEvent(events, {
      id: Event.ID.make("evt_prompt_admitted", { disableChecks: true }),
      created: 3,
      type: "session.inbox.enqueued",
      durable: durable(sessionID, 3),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-user", { disableChecks: true }),
        item: { type: "user", payload: { text: "Continue" }, delivery: "steer" },
      },
    })
    await wait(() => rows.at(-1)?.type === "message")
    expect(rows.find((row) => row.type === "group")?.completed).toBe(false)

    emitEvent(events, {
      id: Event.ID.make("evt_prompt_promoted", { disableChecks: true }),
      created: 4,
      type: "session.inbox.delivered",
      durable: durable(sessionID, 4),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-user", { disableChecks: true }),
      },
    })
    await wait(() => rows.find((row) => row.type === "group")?.completed === true)
    expect(rows.at(-1)).toMatchObject({ type: "message", messageID: "message-user" })
    // Promotion rebuilds every row; the live text must keep its store object or it remounts.
    expect(text).toMatchObject({ type: "part", ref: { messageID: "message-assistant", partID: "text:0" } })
    expect(rows.find((row) => row.type === "part")).toBe(text)
  } finally {
    app.renderer.destroy()
  }
})

test("updates and removes queued inputs from durable lifecycle events", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-queue-management", { disableChecks: true })
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
      id: Event.ID.make("evt_queue_admitted", { disableChecks: true }),
      created: 1,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-queued", { disableChecks: true }),
        item: { type: "user", payload: { text: "Steer me" }, delivery: "queue" },
      },
    })
    await wait(() => data.session.pending.list(sessionID).length === 1)
    expect(rows).not.toContainEqual(expect.objectContaining({ type: "message", messageID: "message-queued" }))

    emitEvent(events, {
      id: Event.ID.make("evt_queue_steered", { disableChecks: true }),
      created: 2,
      type: "session.inbox.delivery.changed",
      durable: durable(sessionID, 1),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-queued", { disableChecks: true }),
        delivery: "steer",
      },
    })
    await wait(() =>
      data.session.pending
        .list(sessionID)
        .some((item) => item.id === "message-queued" && item.type !== "compaction" && item.delivery === "steer"),
    )
    expect(rows).toContainEqual(expect.objectContaining({ type: "message", messageID: "message-queued" }))

    emitEvent(events, {
      id: Event.ID.make("evt_queue_restored", { disableChecks: true }),
      created: 3,
      type: "session.inbox.delivery.changed",
      durable: durable(sessionID, 2),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-queued", { disableChecks: true }),
        delivery: "queue",
      },
    })
    await wait(() =>
      data.session.pending
        .list(sessionID)
        .some((item) => item.id === "message-queued" && item.type !== "compaction" && item.delivery === "queue"),
    )
    expect(rows).not.toContainEqual(expect.objectContaining({ type: "message", messageID: "message-queued" }))

    emitEvent(events, {
      id: Event.ID.make("evt_cancel_admitted", { disableChecks: true }),
      created: 4,
      type: "session.inbox.enqueued",
      durable: durable(sessionID, 3),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-cancelled", { disableChecks: true }),
        item: { type: "user", payload: { text: "Delete me" }, delivery: "queue" },
      },
    })
    await wait(() => data.session.pending.list(sessionID).length === 2)
    emitEvent(events, {
      id: Event.ID.make("evt_queue_cancelled", { disableChecks: true }),
      created: 5,
      type: "session.inbox.cancelled",
      durable: durable(sessionID, 4),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-cancelled", { disableChecks: true }),
      },
    })
    await wait(
      () => !data.session.input.has(sessionID, SessionMessage.ID.make("message-cancelled", { disableChecks: true })),
    )
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual([
      SessionMessage.ID.make("message-queued", { disableChecks: true }),
    ])
    expect(
      data.session.message.get(sessionID, SessionMessage.ID.make("message-cancelled", { disableChecks: true })),
    ).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("classifies live tool rows independently of their call ID", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-tool-call-id", { disableChecks: true })
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
      id: Event.ID.make("evt_tool_started", { disableChecks: true }),
      created: 1,
      type: "session.tool.input.started",
      durable: durable(sessionID),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        id: "reasoning:0",
        name: "bash",
      },
    })

    await wait(() => rows.length > 0)
    expect(unwrap(rows)).toMatchObject([
      { type: "part", ref: { messageID: "message-assistant", partID: "reasoning:0" } },
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("loads older pages until the oldest exploration group is complete before reporting sync and keeps existing rows", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-boundary", { disableChecks: true })
  const model = { id: "model", providerID: Provider.ID.make("provider", { disableChecks: true }) }
  // One prompt, 50 single-read steps, then an answer: the 20-message first page cuts the group.
  const history = [
    {
      type: "user",
      id: SessionMessage.ID.make("msg_000", { disableChecks: true }),
      text: "Explore",
      time: { created: 0 },
    },
    ...Array.from({ length: 50 }, (_, index) => ({
      type: "assistant",
      id: `msg_${String(index + 1).padStart(3, "0")}`,
      agent: Agent.ID.make("build", { disableChecks: true }),
      model,
      time: { created: index + 1, completed: index + 1 },
      finish: "tool-calls",
      content: [
        {
          type: "tool",
          id: `read-${index}`,
          name: "read",
          time: { created: index + 1, completed: index + 1 },
          state: { status: "completed", input: { path: `${index}.ts` }, content: [], metadata: {} },
        },
      ],
    })),
    {
      type: "assistant",
      id: "msg_051",
      agent: "build",
      model,
      time: { created: 51, completed: 51 },
      finish: "stop",
      content: [{ type: "text", text: "Done" }],
    },
  ]
  const pages: string[] = []
  const older = Promise.withResolvers<void>()
  const calls = createFetch(async (url) => {
    if (url.pathname !== `/api/session/${sessionID}/message`) return
    const cursor = url.searchParams.get("cursor")
    if (cursor) await older.promise
    const end = Number(cursor ?? history.length)
    const start = Math.max(0, end - Number(url.searchParams.get("limit") ?? 20))
    pages.push(`${start}-${end}`)
    return json({ data: history.slice(start, end).toReversed(), cursor: start > 0 ? { next: String(start) } : {} })
  }, events)
  let rows!: ReturnType<typeof createSessionRows>
  let client!: ReturnType<typeof useClient>
  const synced: SessionRow[] = []

  function Probe() {
    client = useClient()
    rows = createSessionRows(
      () => sessionID,
      () => synced.push(structuredClone(unwrap(rows[0]))),
    )
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
    const answer = () => rows.find((row) => row.type === "part" && row.ref.messageID === "msg_051")
    await wait(() => answer() !== undefined)
    const mounted = answer()
    older.resolve()
    await wait(() => synced.length > 0, 4000)
    expect(pages).toEqual(["32-52", "12-32", "0-12"])
    // Sync is reported only once the group's true first read is loaded.
    expect(synced[0]).toMatchObject({ type: "message", messageID: "msg_000" })
    const group = rows[1]
    if (group?.type !== "group") throw new Error("Expected exploration group")
    expect(group.size).toBe(50)
    expect(groupRefs(group)[0]).toEqual({
      messageID: SessionMessage.ID.make("msg_001", { disableChecks: true }),
      partID: "read-0",
    })
    // The transcript keys rows by store object, so a new object would remount the answer.
    expect(answer()).toBe(mounted)
  } finally {
    app.renderer.destroy()
  }
})

test("removes committed revert messages from local state", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-revert", { disableChecks: true })
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
    for (const [seq, inboxID] of [
      SessionMessage.ID.make("msg_001", { disableChecks: true }),
      SessionMessage.ID.make("msg_002", { disableChecks: true }),
      SessionMessage.ID.make("msg_003", { disableChecks: true }),
    ].entries()) {
      emitEvent(events, {
        id: Event.ID.create(),
        created: seq,
        type: "session.inbox.enqueued",
        durable: durable(sessionID, seq),
        data: {
          sessionID: Session.ID.make(sessionID, { disableChecks: true }),
          inboxID,
          item: { type: "user", payload: { text: inboxID }, delivery: "steer" },
        },
      })
    }
    await wait(() => data.session.message.list(sessionID).length === 3)

    emitEvent(events, {
      id: Event.ID.create(),
      created: 3,
      type: "session.revert.committed",
      durable: durable(sessionID, 3),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        to: SessionMessage.ID.make("msg_002", { disableChecks: true }),
      },
    })

    await wait(() => data.session.message.list(sessionID).length === 1)
    expect(data.session.message.list(sessionID).map((message) => message.id)).toEqual([
      SessionMessage.ID.make("msg_001", { disableChecks: true }),
    ])
    expect(
      data.session.message.get(sessionID, SessionMessage.ID.make("msg_002", { disableChecks: true })),
    ).toBeUndefined()
    expect(
      data.session.message.get(sessionID, SessionMessage.ID.make("msg_003", { disableChecks: true })),
    ).toBeUndefined()
    // The projector also drops inbox items enqueued at or after the boundary, without a cancel event.
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual([
      SessionMessage.ID.make("msg_001", { disableChecks: true }),
    ])
    expect(data.session.input.list(sessionID)).toEqual([SessionMessage.ID.make("msg_001", { disableChecks: true })])
    expect(data.session.input.has(sessionID, SessionMessage.ID.make("msg_002", { disableChecks: true }))).toBe(false)
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
        `data: ${JSON.stringify({ id: Event.ID.make("evt_connected", { disableChecks: true }), created: 0, type: "server.connected", data: {} })}\n\n`,
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
          projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
          projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
    rows = createSessionRows(() => Session.ID.make("session-retry", { disableChecks: true }))
    manualRows = createSessionRows(() => Session.ID.make("session-manual", { disableChecks: true }))
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
    await wait(() => data.session.status(Session.ID.make("session-active", { disableChecks: true })) === "running")
    expect(data.session.status(Session.ID.make("session-idle", { disableChecks: true }))).toBe("idle")
    await data.session.sync(Session.ID.make("session-live", { disableChecks: true }))

    settled = true
    emitEvent(events, {
      id: Event.ID.make("evt_execution_started", { disableChecks: true }),
      created: 0,
      type: "session.execution.started",
      durable: durable("session-live"),
      data: { sessionID: Session.ID.make("session-live", { disableChecks: true }) },
    })
    await wait(() => data.session.status(Session.ID.make("session-live", { disableChecks: true })) === "running")

    emitEvent(events, {
      id: Event.ID.make("evt_step_started", { disableChecks: true }),
      created: 0,
      type: "session.step.started",
      durable: durable("session-live"),
      data: {
        started: 0,
        sessionID: Session.ID.make("session-live", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-live", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_step_ended", { disableChecks: true }),
      created: 0,
      type: "session.step.ended",
      durable: durable("session-live", 1),
      data: {
        sessionID: Session.ID.make("session-live", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-live", { disableChecks: true }),
        finish: "stop",
        cost: 0.75,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_step_usage", { disableChecks: true }),
      created: 0,
      type: "session.usage.updated",
      data: {
        sessionID: Session.ID.make("session-live", { disableChecks: true }),
        cost: 0.75,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get(
        Session.ID.make("session-live", { disableChecks: true }),
        SessionMessage.ID.make("message-live", { disableChecks: true }),
      )
      return assistant?.type === "assistant" && assistant.finish === "stop"
    })
    await wait(() => data.session.get(Session.ID.make("session-live", { disableChecks: true }))?.cost === 0.75)
    expect(data.session.status(Session.ID.make("session-live", { disableChecks: true }))).toBe("running")
    expect(data.session.get(Session.ID.make("session-live", { disableChecks: true }))).toMatchObject({
      cost: 0.75,
      tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
    })

    emitEvent(events, {
      id: Event.ID.make("evt_execution_succeeded", { disableChecks: true }),
      created: 0,
      type: "session.execution.succeeded",
      durable: durable("session-live", 1),
      data: { sessionID: Session.ID.make("session-live", { disableChecks: true }) },
    })
    await wait(() => data.session.status(Session.ID.make("session-live", { disableChecks: true })) === "idle")

    await data.session.sync(Session.ID.make("session-failed", { disableChecks: true }))
    emitEvent(events, {
      id: Event.ID.make("evt_failed_execution_started", { disableChecks: true }),
      created: 0,
      type: "session.execution.started",
      durable: durable("session-failed"),
      data: { sessionID: Session.ID.make("session-failed", { disableChecks: true }) },
    })
    await wait(() => data.session.status(Session.ID.make("session-failed", { disableChecks: true })) === "running")

    emitEvent(events, {
      id: Event.ID.make("evt_failed_step_started", { disableChecks: true }),
      created: 0,
      type: "session.step.started",
      durable: durable("session-failed"),
      data: {
        started: 0,
        sessionID: Session.ID.make("session-failed", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-failed", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_step_failed", { disableChecks: true }),
      created: 0,
      type: "session.step.failed",
      durable: durable("session-failed", 1),
      data: {
        sessionID: Session.ID.make("session-failed", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-failed", { disableChecks: true }),
        error: { type: "provider.content-filter", message: "Provider blocked the response" },
        cost: 0.25,
        tokens: { input: 5, output: 1, reasoning: 1, cache: { read: 1, write: 0 } },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_failed_step_usage", { disableChecks: true }),
      created: 0,
      type: "session.usage.updated",
      data: {
        sessionID: Session.ID.make("session-failed", { disableChecks: true }),
        cost: 0.25,
        tokens: { input: 5, output: 1, reasoning: 1, cache: { read: 1, write: 0 } },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get(
        Session.ID.make("session-failed", { disableChecks: true }),
        SessionMessage.ID.make("message-failed", { disableChecks: true }),
      )
      return (
        assistant?.type === "assistant" &&
        assistant.finish === "error" &&
        assistant.error?.type === "provider.content-filter"
      )
    })
    await wait(() => data.session.get(Session.ID.make("session-failed", { disableChecks: true }))?.cost === 0.25)
    expect(data.session.get(Session.ID.make("session-failed", { disableChecks: true }))?.tokens).toEqual({
      input: 5,
      output: 1,
      reasoning: 1,
      cache: { read: 1, write: 0 },
    })
    expect(data.session.status(Session.ID.make("session-failed", { disableChecks: true }))).toBe("running")

    emitEvent(events, {
      id: Event.ID.make("evt_failed_execution_failed", { disableChecks: true }),
      created: 0,
      type: "session.execution.failed",
      durable: durable("session-failed", 1),
      data: {
        sessionID: Session.ID.make("session-failed", { disableChecks: true }),
        error: { type: "provider.content-filter", message: "Provider blocked the response" },
      },
    })
    await wait(() => data.session.status(Session.ID.make("session-failed", { disableChecks: true })) === "idle")

    emitEvent(events, {
      id: Event.ID.make("evt_retry_execution_started", { disableChecks: true }),
      created: 0,
      type: "session.execution.started",
      durable: durable("session-retry"),
      data: { sessionID: Session.ID.make("session-retry", { disableChecks: true }) },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_retry_step_started", { disableChecks: true }),
      created: 0,
      type: "session.step.started",
      durable: durable("session-retry", 1),
      data: {
        started: 0,
        sessionID: Session.ID.make("session-retry", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-retry", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_retry_scheduled", { disableChecks: true }),
      created: 0,
      type: "session.retry.scheduled",
      durable: durable("session-retry", 1),
      data: {
        sessionID: Session.ID.make("session-retry", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-retry", { disableChecks: true }),
        attempt: 2,
        at: 2_000,
        error: { type: "provider.transport", message: "Disconnected" },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get(
        Session.ID.make("session-retry", { disableChecks: true }),
        SessionMessage.ID.make("message-retry", { disableChecks: true }),
      )
      return assistant?.type === "assistant" && assistant.retry?.attempt === 2
    })
    await wait(() => rows.some((row) => row.type === "assistant-footer" && row.messageID === "message-retry"))
    emitEvent(events, {
      id: Event.ID.make("evt_retry_next_step", { disableChecks: true }),
      created: 2_000,
      type: "session.step.started",
      durable: durable("session-retry", 1),
      data: {
        started: 2_000,
        sessionID: Session.ID.make("session-retry", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-retry", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get(
        Session.ID.make("session-retry", { disableChecks: true }),
        SessionMessage.ID.make("message-retry", { disableChecks: true }),
      )
      return assistant?.type === "assistant" && assistant.retry === undefined
    })
    await wait(() => !rows.some((row) => row.type === "assistant-footer" && row.messageID === "message-retry"))
    expect(
      data.session.message
        .list(Session.ID.make("session-retry", { disableChecks: true }))
        .filter((message) => message.type === "assistant"),
    ).toHaveLength(1)
    emitEvent(events, {
      id: Event.ID.make("evt_retry_scheduled_again", { disableChecks: true }),
      created: 2_000,
      type: "session.retry.scheduled",
      durable: durable("session-retry", 1),
      data: {
        sessionID: Session.ID.make("session-retry", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-retry", { disableChecks: true }),
        attempt: 3,
        at: 6_000,
        error: { type: "provider.transport", message: "Disconnected again" },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get(
        Session.ID.make("session-retry", { disableChecks: true }),
        SessionMessage.ID.make("message-retry", { disableChecks: true }),
      )
      return assistant?.type === "assistant" && assistant.retry?.attempt === 3
    })
    emitEvent(events, {
      id: Event.ID.make("evt_retry_interrupted", { disableChecks: true }),
      created: 2_000,
      type: "session.execution.interrupted",
      durable: durable("session-retry", 1),
      data: { sessionID: Session.ID.make("session-retry", { disableChecks: true }), reason: "shutdown" },
    })
    await wait(() => data.session.status(Session.ID.make("session-retry", { disableChecks: true })) === "idle")
    expect(
      data.session.message.get(
        Session.ID.make("session-retry", { disableChecks: true }),
        SessionMessage.ID.make("message-retry", { disableChecks: true }),
      ),
    ).not.toHaveProperty("retry")

    emitEvent(events, {
      id: Event.ID.make("evt_manual_compaction_admitted", { disableChecks: true }),
      created: 0,
      type: "session.inbox.enqueued",
      durable: durable("session-manual", 1),
      data: {
        sessionID: Session.ID.make("session-manual", { disableChecks: true }),
        inboxID: SessionMessage.ID.make("message-compaction", { disableChecks: true }),
        item: { type: "compaction", payload: {}, delivery: "queue" },
      },
    })
    await wait(() =>
      data.session.pending
        .list(Session.ID.make("session-manual", { disableChecks: true }))
        .some((item) => item.id === "message-compaction"),
    )
    emitEvent(events, {
      id: Event.ID.make("evt_manual_compaction_started", { disableChecks: true }),
      created: 1,
      type: "session.compaction.started",
      durable: durable("session-manual", 2),
      data: {
        sessionID: Session.ID.make("session-manual", { disableChecks: true }),
        reason: "manual",
        recent: "",
        inputID: SessionMessage.ID.make("message-compaction", { disableChecks: true }),
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_manual_compaction_delta", { disableChecks: true }),
      created: 2,
      type: "session.compaction.delta",
      data: { sessionID: Session.ID.make("session-manual", { disableChecks: true }), text: "Streamed summary" },
    })
    await wait(() => {
      const message = data.session.message.get(
        Session.ID.make("session-manual", { disableChecks: true }),
        SessionMessage.ID.make("message-compaction", { disableChecks: true }),
      )
      return message?.type === "compaction" && message.status === "running" && message.summary === "Streamed summary"
    })
    expect(data.session.pending.list(Session.ID.make("session-manual", { disableChecks: true }))).toEqual([])
    const compactionRow = manualRows.find((row) => row.type === "message" && row.messageID === "message-compaction")
    emitEvent(events, {
      id: Event.ID.make("evt_manual_compaction_ended", { disableChecks: true }),
      created: 3,
      type: "session.compaction.ended",
      durable: durable("session-manual", 4),
      data: {
        sessionID: Session.ID.make("session-manual", { disableChecks: true }),
        reason: "manual",
        text: "Streamed summary",
        recent: "recent",
      },
    })
    await wait(() => {
      const message = data.session.message.get(
        Session.ID.make("session-manual", { disableChecks: true }),
        SessionMessage.ID.make("message-compaction", { disableChecks: true }),
      )
      return message?.type === "compaction" && message.status === "completed"
    })
    expect(manualRows.filter((row) => row.type === "message")).toMatchObject([
      { type: "message", messageID: "message-compaction" },
    ])
    expect(manualRows.find((row) => row.type === "message" && row.messageID === "message-compaction")).toBe(
      compactionRow,
    )

    emitEvent(events, {
      id: Event.ID.make("evt_compaction_started", { disableChecks: true }),
      created: 0,
      type: "session.compaction.started",
      durable: durable("session-live", 2),
      data: { sessionID: Session.ID.make("session-live", { disableChecks: true }), reason: "auto", recent: "" },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_compaction_delta_1", { disableChecks: true }),
      created: 0,
      type: "session.compaction.delta",
      data: { sessionID: Session.ID.make("session-live", { disableChecks: true }), text: "Live " },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_compaction_delta_2", { disableChecks: true }),
      created: 0,
      type: "session.compaction.delta",
      data: { sessionID: Session.ID.make("session-live", { disableChecks: true }), text: "summary" },
    })
    await wait(() => {
      const message = data.session.message.get(
        Session.ID.make("session-live", { disableChecks: true }),
        SessionMessage.ID.make("msg_compaction_started", { disableChecks: true }),
      )
      return message?.type === "compaction" && message.status === "running" && message.summary === "Live summary"
    })
    const autoCompactionRow = rows.find(
      (row) =>
        row.type === "message" &&
        row.messageID === SessionMessage.ID.make("msg_compaction_started", { disableChecks: true }),
    )

    emitEvent(events, {
      id: Event.ID.make("evt_compaction_ended", { disableChecks: true }),
      created: 0,
      type: "session.compaction.ended",
      durable: durable("session-live", 5),
      data: {
        sessionID: Session.ID.make("session-live", { disableChecks: true }),
        reason: "auto",
        text: "Live summary",
        recent: "recent",
      },
    })
    await wait(() => {
      const message = data.session.message.get(
        Session.ID.make("session-live", { disableChecks: true }),
        SessionMessage.ID.make("msg_compaction_started", { disableChecks: true }),
      )
      return message?.type === "compaction" && message.status === "completed"
    })
    expect(
      data.session.message.get(
        Session.ID.make("session-live", { disableChecks: true }),
        SessionMessage.ID.make("msg_compaction_started", { disableChecks: true }),
      ),
    ).toMatchObject({
      type: "compaction",
      status: "completed",
      summary: "Live summary",
    })
    expect(
      rows.find(
        (row) =>
          row.type === "message" &&
          row.messageID === SessionMessage.ID.make("msg_compaction_started", { disableChecks: true }),
      ),
    ).toBe(autoCompactionRow)
    expect(
      rows.some(
        (row) =>
          row.type === "message" &&
          row.messageID === SessionMessage.ID.make("msg_compaction_ended", { disableChecks: true }),
      ),
    ).toBeFalse()
  } finally {
    app.renderer.destroy()
  }
})

test.each(["before", "between", "after"])("shows compaction admitted %s steers in execution order", async (order) => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-compaction-priority", { disableChecks: true })
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
    return undefined
  }, events)
  let rows: SessionRow[] = []
  let client: ReturnType<typeof useClient> | undefined
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
  const admissions =
    order === "before" ? ["compact", "a", "b"] : order === "between" ? ["a", "compact", "b"] : ["a", "b", "compact"]
  try {
    await wait(() => client?.connection.status() === "connected")
    admissions.forEach((id, index) =>
      emitEvent(events, {
        id: Event.ID.make(`evt_admit_${id}`, { disableChecks: true }),
        created: index + 1,
        type: "session.inbox.enqueued",
        durable: durable(sessionID, index + 1),
        data: {
          sessionID: Session.ID.make(sessionID, { disableChecks: true }),
          inboxID: SessionMessage.ID.make(id, { disableChecks: true }),
          item:
            id === "compact"
              ? { type: "compaction", payload: {}, delivery: "steer" }
              : { type: "user", payload: { text: `STEER_${id.toUpperCase()}` }, delivery: "steer" },
        },
      }),
    )
    await wait(() => rows.length === 3)
    expect(unwrap(rows)).toMatchObject([
      { type: "compaction-queued", inboxID: "compact" },
      { type: "message", messageID: "a" },
      { type: "message", messageID: "b" },
    ])
    emitEvent(events, {
      id: Event.ID.make("evt_compaction_started", { disableChecks: true }),
      created: 4,
      type: "session.compaction.started",
      durable: durable(sessionID, 4),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        reason: "manual",
        recent: "",
        inputID: SessionMessage.ID.make("compact", { disableChecks: true }),
      },
    })
    await wait(() => rows[0]?.type === "message")
    expect(unwrap(rows)).toMatchObject(["compact", "a", "b"].map((messageID) => ({ type: "message", messageID })))
    emitEvent(events, {
      id: Event.ID.make("evt_compaction_ended", { disableChecks: true }),
      created: 5,
      type: "session.compaction.ended",
      durable: durable(sessionID, 5),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        reason: "manual",
        text: "## Objective\n- Checkpoint",
        recent: "",
      },
    })
    for (const [index, id] of ["a", "b"].entries()) {
      emitEvent(events, {
        id: Event.ID.make(`evt_deliver_${id}`, { disableChecks: true }),
        created: index + 6,
        type: "session.inbox.delivered",
        durable: durable(sessionID, index + 6),
        data: {
          sessionID: Session.ID.make(sessionID, { disableChecks: true }),
          inboxID: SessionMessage.ID.make(id, { disableChecks: true }),
        },
      })
    }
    await app.renderOnce()
    expect(unwrap(rows)).toMatchObject(["compact", "a", "b"].map((messageID) => ({ type: "message", messageID })))
  } finally {
    app.renderer.destroy()
  }
})

test("restores queued compaction from durable pending input", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-compaction-queued", { disableChecks: true })
  let pending = [
    {
      id: "message-compaction-queued",
      sessionID: Session.ID.make(sessionID, { disableChecks: true }),
      time: { created: 1 },
      type: "compaction" as const,
      payload: {},
      delivery: "queue" as const,
    },
    {
      id: "message-compaction-later",
      sessionID: Session.ID.make(sessionID, { disableChecks: true }),
      time: { created: 2 },
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
      SessionMessage.ID.make("message-compaction-queued", { disableChecks: true }),
      SessionMessage.ID.make("message-compaction-later", { disableChecks: true }),
    ])
    await wait(() => rows.filter((row) => row.type === "compaction-queued").length === 2)
    expect(rows.filter((row) => row.type === "compaction-queued")).toMatchObject([
      { type: "compaction-queued", inboxID: "message-compaction-queued" },
      { type: "compaction-queued", inboxID: "message-compaction-later" },
    ])

    emitEvent(events, {
      id: Event.ID.make("evt_step_started", { disableChecks: true }),
      created: 2,
      type: "session.step.started",
      durable: durable(sessionID, 3),
      data: {
        started: 2,
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_text_started", { disableChecks: true }),
      created: 2,
      type: "session.text.started",
      durable: durable(sessionID, 4),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        ordinal: 0,
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_text_ended", { disableChecks: true }),
      created: 2,
      type: "session.text.ended",
      durable: durable(sessionID, 5),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("message-assistant", { disableChecks: true }),
        ordinal: 0,
        text: "Active output",
      },
    })
    await wait(() => rows.some((row) => row.type === "part"))
    expect(rows.map((row) => row.type)).toEqual(["part", "compaction-queued", "compaction-queued"])

    emitEvent(events, {
      id: Event.ID.make("evt_compaction_started", { disableChecks: true }),
      created: 2,
      type: "session.compaction.started",
      durable: durable(sessionID, 6),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        reason: "manual",
        recent: "",
        inputID: SessionMessage.ID.make("message-compaction-queued", { disableChecks: true }),
      },
    })
    await wait(() => data.session.pending.list(sessionID).length === 1)
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual([
      SessionMessage.ID.make("message-compaction-later", { disableChecks: true }),
    ])

    emitEvent(events, {
      id: Event.ID.make("evt_compaction_ended", { disableChecks: true }),
      created: 3,
      type: "session.compaction.ended",
      durable: durable(sessionID, 7),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        reason: "manual",
        text: "Summary",
        recent: "",
      },
    })
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual([
      SessionMessage.ID.make("message-compaction-later", { disableChecks: true }),
    ])

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
                connections: [{ type: "credential", method: "key", id: "cred_openai", label: "OpenAI" }],
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

    emitEvent(events, {
      id: Event.ID.make("evt_integration", { disableChecks: true }),
      created: 0,
      type: "integration.updated",
      data: {},
    })
    await wait(() => data.location.integration.list()?.length === 1)
    await wait(() => requests.model > before.model && requests.provider > before.provider)
    expect(data.location.integration.list()?.[0]).toMatchObject({ id: "openai", name: "OpenAI" })

    const previous = { ...requests }
    events.emit({
      id: Event.ID.make("evt_credential", { disableChecks: true }),
      created: 0,
      type: "credential.switched",
      data: {
        credentialID: Credential.ID.make("cred_openai", { disableChecks: true }),
        integrationID: Integration.ID.make("openai", { disableChecks: true }),
      },
    })
    await wait(() => requests.model > previous.model && requests.provider > previous.provider)
    expect(requests.integration).toBe(previous.integration)
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
      id: Event.ID.make("evt_mcp_resources", { disableChecks: true }),
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

test("refreshes provider and model data independently after domain updates", async () => {
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
    emitEvent(events, {
      id: Event.ID.make("evt_provider", { disableChecks: true }),
      created: 0,
      type: "provider.updated",
      data: {},
    })
    await wait(() => requests.provider > before.provider)
    expect(requests).toEqual({ model: before.model, provider: before.provider + 1 })

    emitEvent(events, {
      id: Event.ID.make("evt_model", { disableChecks: true }),
      created: 0,
      type: "model.updated",
      data: {},
    })
    await wait(() => requests.model > before.model)
    expect(requests).toEqual({ model: before.model + 1, provider: before.provider + 1 })
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
    emitEvent(events, {
      id: Event.ID.make("evt_agent", { disableChecks: true }),
      created: 0,
      type: "agent.updated",
      data: {},
    })
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
    emitEvent(events, {
      id: Event.ID.make("evt_reference_1", { disableChecks: true }),
      created: 0,
      type: "reference.updated",
      data: {},
    })
    await wait(() => data.location.reference.list()?.length === 1)
    expect(data.location.reference.list()?.[0]?.name).toBe("docs")
  } finally {
    app.renderer.destroy()
  }
})

test("keeps shell state scoped to location", async () => {
  const events = createEventStream()
  const other = "/tmp/opencode/other"
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
        project: { id: "proj_test", directory: requestDirectory ?? directory },
      },
      data: [
        {
          id:
            requestDirectory === other
              ? Shell.ID.make("sh_other", { disableChecks: true })
              : Shell.ID.make("sh_default", { disableChecks: true }),
          status: "running",
          command: requestDirectory === other ? "pnpm dev" : "bun test",
          cwd: requestDirectory ?? directory,
          shell: "/bin/sh",
          file: "/tmp/opencode-shell",
          metadata: { sessionID: Session.ID.make("ses_shared", { disableChecks: true }) },
          time: { started: 1 },
        },
      ],
    })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return (
      <RouteProvider
        initialRoute={{ type: "session", sessionID: Session.ID.make("ses_shared", { disableChecks: true }) }}
      >
        <Keymap.Provider>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <ToastProvider>
              <DialogProvider>
                <Composer
                  sessionID={Session.ID.make("ses_shared", { disableChecks: true })}
                  open={true}
                  defaultTab="shell"
                />
              </DialogProvider>
            </ToastProvider>
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
    await wait(() =>
      data.shell.list().some((shell) => shell.id === Shell.ID.make("sh_default", { disableChecks: true })),
    )
    await data.shell.sync({ directory: other })

    expect(data.shell.list().map((shell) => shell.id)).toEqual([Shell.ID.make("sh_default", { disableChecks: true })])
    expect(data.shell.list({ directory: other }).map((shell) => shell.id)).toEqual([
      Shell.ID.make("sh_other", { disableChecks: true }),
    ])
    expect(
      data.shell
        .listBySession(Session.ID.make("ses_shared", { disableChecks: true }))
        .map((shell) => [shell.id, shell.location.directory]),
    ).toEqual([
      ["sh_default", directory],
      ["sh_other", other],
    ])

    await app.waitForFrame((frame) => frame.includes("pnpm dev"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressKey("d", { ctrl: true })
    await wait(() => removed !== undefined)
    expect(removed?.searchParams.get("location[directory]")).toBe(other)
    expect(removed?.searchParams.has("location[workspace]")).toBe(false)

    events.emit({
      id: Event.ID.make("evt_shell_created", { disableChecks: true }),
      created: 0,
      type: "shell.created",
      location: { directory: other },
      data: {
        info: {
          id: Shell.ID.make("sh_live_other", { disableChecks: true }),
          status: "running",
          command: "npm run watch",
          cwd: other,
          shell: "/bin/sh",
          file: "/tmp/opencode-shell-live",
          metadata: { sessionID: Session.ID.make("ses_shared", { disableChecks: true }) },
          time: { started: 2 },
        },
      },
    })
    await wait(() =>
      data.shell
        .list({ directory: other })
        .some((shell) => shell.id === Shell.ID.make("sh_live_other", { disableChecks: true })),
    )
    expect(data.shell.list().map((shell) => shell.id)).toEqual([Shell.ID.make("sh_default", { disableChecks: true })])
    expect(
      data.shell
        .listBySession(Session.ID.make("ses_shared", { disableChecks: true }))
        .find((shell) => shell.id === Shell.ID.make("sh_live_other", { disableChecks: true }))?.location.directory,
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
      id: Event.ID.make("evt_permission_asked_1", { disableChecks: true }),
      created: 0,
      type: "permission.asked",
      data: {
        id: Permission.ID.make("per_1", { disableChecks: true }),
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        action: "bash",
        resources: ["bun test"],
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_permission_asked_2", { disableChecks: true }),
      created: 0,
      type: "permission.asked",
      data: {
        id: Permission.ID.make("per_2", { disableChecks: true }),
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        action: "read",
        resources: [".env"],
      },
    })
    await wait(() => data.session.permission.list(Session.ID.make("ses_1", { disableChecks: true }))?.length === 2)

    emitEvent(events, {
      id: Event.ID.make("evt_permission_replied_1", { disableChecks: true }),
      created: 0,
      type: "permission.replied",
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        requestID: Permission.ID.make("per_1", { disableChecks: true }),
        reply: "once",
      },
    })
    await wait(() => data.session.permission.list(Session.ID.make("ses_1", { disableChecks: true }))?.length === 1)
    expect(data.session.permission.list(Session.ID.make("ses_1", { disableChecks: true }))?.[0]?.id).toBe(
      Permission.ID.make("per_2", { disableChecks: true }),
    )

    emitEvent(events, {
      id: Event.ID.make("evt_permission_replied_2", { disableChecks: true }),
      created: 0,
      type: "permission.replied",
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        requestID: Permission.ID.make("per_2", { disableChecks: true }),
        reply: "reject",
      },
    })
    await wait(() => data.session.permission.list(Session.ID.make("ses_1", { disableChecks: true }))?.length === 0)
  } finally {
    app.renderer.destroy()
  }
})

test("reconciles active session permissions when the event stream reconnects", async () => {
  const events = createEventStream()
  let requests = [
    {
      id: "per_old",
      sessionID: Session.ID.make("ses_active", { disableChecks: true }),
      action: "read",
      resources: ["old.txt"],
    },
    {
      id: "per_keep",
      sessionID: Session.ID.make("ses_active", { disableChecks: true }),
      action: "shell",
      resources: ["bun test"],
    },
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
      void data.session.permission.sync(Session.ID.make("ses_active", { disableChecks: true }))
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
    await wait(() => data.session.permission.list(Session.ID.make("ses_active", { disableChecks: true }))?.length === 2)

    requests = [
      {
        id: "per_new",
        sessionID: Session.ID.make("ses_active", { disableChecks: true }),
        action: "edit",
        resources: ["new.txt"],
      },
    ]
    events.disconnect()

    await wait(
      () =>
        calls === 2 &&
        data.session.permission.list(Session.ID.make("ses_active", { disableChecks: true }))?.[0]?.id === "per_new",
    )
  } finally {
    app.renderer.destroy()
  }
})

test("dismisses a permission that expired before its reply", async () => {
  const events = createEventStream()
  const request = {
    id: Permission.ID.make("per_stale", { disableChecks: true }),
    sessionID: Session.ID.make("ses_active", { disableChecks: true }),
    action: "read",
    resources: ["old.txt"],
  }
  let replies = 0
  const calls = createFetch((url, init) => {
    if (url.pathname === "/api/session/ses_active/permission/per_stale/reply" && init.method === "POST") {
      replies++
      return json(
        {
          _tag: "PermissionNotFoundError",
          requestID: Permission.ID.make(request.id, { disableChecks: true }),
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
      id: Event.ID.make("evt_permission_asked_stale", { disableChecks: true }),
      created: 0,
      type: "permission.asked",
      data: request,
    })
    await wait(() => data.session.permission.list(request.sessionID)?.length === 1)

    await data.session.permission.reply({
      sessionID: Session.ID.make(request.sessionID, { disableChecks: true }),
      requestID: Permission.ID.make(request.id, { disableChecks: true }),
      decision: "once",
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
      data: [
        {
          id: Form.ID.make("frm_remote", { disableChecks: true }),
          sessionID: Session.ID.make("ses_1", { disableChecks: true }),
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
    await wait(() => client.connection.status() === "connected")
    emitEvent(events, {
      id: Event.ID.make("evt_form_created_1", { disableChecks: true }),
      created: 0,
      type: "form.created",
      data: {
        form: {
          id: Form.ID.make("frm_1", { disableChecks: true }),
          sessionID: Session.ID.make("ses_1", { disableChecks: true }),
          title: "Input requested",
          fields: formFields,
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_form_created_duplicate", { disableChecks: true }),
      created: 1,
      type: "form.created",
      data: {
        form: {
          id: Form.ID.make("frm_1", { disableChecks: true }),
          sessionID: Session.ID.make("ses_1", { disableChecks: true }),
          title: "Input requested",
          fields: formFields,
        },
      },
    })
    await wait(() => data.session.form.list(Session.ID.make("ses_1", { disableChecks: true }))?.length === 1)

    emitEvent(events, {
      id: Event.ID.make("evt_form_replied_1", { disableChecks: true }),
      created: 2,
      type: "form.replied",
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        id: Form.ID.make("frm_1", { disableChecks: true }),
        answer: {},
      },
    })
    await wait(() => data.session.form.list(Session.ID.make("ses_1", { disableChecks: true }))?.length === 0)

    emitEvent(events, {
      id: Event.ID.make("evt_form_created_2", { disableChecks: true }),
      created: 3,
      type: "form.created",
      data: {
        form: {
          id: Form.ID.make("frm_2", { disableChecks: true }),
          sessionID: Session.ID.make("ses_1", { disableChecks: true }),
          title: "Input requested",
          fields: formFields,
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_form_cancelled_2", { disableChecks: true }),
      created: 4,
      type: "form.cancelled",
      data: {
        sessionID: Session.ID.make("ses_1", { disableChecks: true }),
        id: Form.ID.make("frm_2", { disableChecks: true }),
      },
    })
    await wait(() => data.session.form.list(Session.ID.make("ses_1", { disableChecks: true }))?.length === 0)

    await data.session.form.sync(Session.ID.make("ses_1", { disableChecks: true }))
    expect(data.session.form.list(Session.ID.make("ses_1", { disableChecks: true }))?.map((form) => form.id)).toEqual([
      Form.ID.make("frm_remote", { disableChecks: true }),
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("tracks global forms by location", async () => {
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const other = { directory: "/tmp/opencode-other" }
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
      id: Event.ID.make("evt_form_created_global_other", { disableChecks: true }),
      created: 0,
      location: other,
      type: "form.created",
      data: {
        form: {
          id: Form.ID.make("frm_other", { disableChecks: true }),
          sessionID: Session.ID.make("global", { disableChecks: true }),
          title: "Input requested",
          fields: formFields,
        },
      },
    })

    await wait(() => data.session.form.list("global", other)?.length === 1)
    expect(data.session.form.list("global", { directory }) ?? []).toEqual([])

    events.emit({
      id: Event.ID.make("evt_form_created_global_default", { disableChecks: true }),
      created: 1,
      location: { directory },
      type: "form.created",
      data: {
        form: {
          id: Form.ID.make("frm_default", { disableChecks: true }),
          sessionID: Session.ID.make("global", { disableChecks: true }),
          title: "Input requested",
          fields: formFields,
        },
      },
    })
    await wait(() => data.session.form.list("global", { directory })?.length === 1)

    events.emit({
      id: Event.ID.make("evt_form_replied_global_other", { disableChecks: true }),
      created: 2,
      location: other,
      type: "form.replied",
      data: {
        id: Form.ID.make("frm_other", { disableChecks: true }),
        sessionID: Session.ID.make("global", { disableChecks: true }),
        answer: {},
      },
    })
    await wait(() => data.session.form.list("global", other)?.length === 0)
    expect(data.session.form.list("global", { directory })?.map((form) => form.id)).toEqual([
      Form.ID.make("frm_default", { disableChecks: true }),
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("syncs global forms once for each requested location", async () => {
  const events = createEventStream()
  const requests: URL[] = []
  const other = { directory: "/tmp/opencode-other" }
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/form") return
    requests.push(url)
    const requestedDirectory = url.searchParams.get("location[directory]") ?? directory
    return json({
      location: {
        directory: requestedDirectory,
        project: { id: "proj_test", directory: requestedDirectory },
      },
      data: [
        {
          id:
            requestedDirectory === other.directory
              ? Form.ID.make("frm_other", { disableChecks: true })
              : Form.ID.make("frm_default", { disableChecks: true }),
          sessionID: Session.ID.make("global", { disableChecks: true }),
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
    expect(requests[0]?.searchParams.has("location[workspace]")).toBe(false)
    expect(data.session.form.list("global", other)?.map((form) => form.id)).toEqual([
      Form.ID.make("frm_other", { disableChecks: true }),
    ])
    expect(data.session.form.list("global", { directory })?.map((form) => form.id)).toEqual([
      Form.ID.make("frm_default", { disableChecks: true }),
    ])

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
  const other = { directory: "/tmp/opencode-other" }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/location")
      return json({ ...home, project: { id: "proj_test", directory: home.directory } })
    if (url.pathname === "/api/session")
      return json({
        data: [
          {
            id: Session.ID.make("ses_default", { disableChecks: true }),
            title: "Default",
            location: home,
            time: { created: 0, updated: 0 },
          },
          {
            id: Session.ID.make("ses_other_1", { disableChecks: true }),
            title: "Other one",
            location: other,
            time: { created: 0, updated: 0 },
          },
          {
            id: Session.ID.make("ses_other_2", { disableChecks: true }),
            title: "Other two",
            location: other,
            time: { created: 0, updated: 0 },
          },
        ],
        cursor: {},
      })
    if (url.pathname !== "/api/form") return
    requests.push(url)
    const requestedDirectory = url.searchParams.get("location[directory]") ?? home.directory
    const count = (counts.get(requestedDirectory) ?? 0) + 1
    counts.set(requestedDirectory, count)
    return json({
      location: {
        directory: requestedDirectory,
        project: { id: "proj_test", directory: requestedDirectory },
      },
      data: [
        {
          id: `frm_${requestedDirectory === other.directory ? "other" : "default"}_${count}`,
          sessionID: Session.ID.make("global", { disableChecks: true }),
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
      () => data.session.form.list("global", home)?.[0]?.id === Form.ID.make("frm_default_1", { disableChecks: true }),
    )
    await data.session.form.sync("global", other)
    expect(data.session.form.list("global", other)?.[0]?.id).toBe(Form.ID.make("frm_other_1", { disableChecks: true }))
    expect(requests).toHaveLength(2)
    requests.length = 0

    events.disconnect()

    await wait(
      () => data.session.form.list("global", home)?.[0]?.id === Form.ID.make("frm_default_2", { disableChecks: true }),
      4000,
    )
    expect(data.session.form.list("global", other)?.[0]?.id).toBe(Form.ID.make("frm_other_1", { disableChecks: true }))
    expect(requests).toHaveLength(1)
    expect(requests.map((url) => url.searchParams.get("location[directory]") ?? directory)).toEqual([home.directory])
  } finally {
    app.renderer.destroy()
  }
})

test("reconciles active session forms when the event stream reconnects", async () => {
  const events = createEventStream()
  let requests = [
    {
      id: Form.ID.make("frm_old", { disableChecks: true }),
      sessionID: Session.ID.make("ses_active", { disableChecks: true }),
      title: "Input requested",
      fields: formFields,
    },
    {
      id: Form.ID.make("frm_keep", { disableChecks: true }),
      sessionID: Session.ID.make("ses_active", { disableChecks: true }),
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
      void data.session.form.sync(Session.ID.make("ses_active", { disableChecks: true }))
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
    await wait(() => data.session.form.list(Session.ID.make("ses_active", { disableChecks: true }))?.length === 2)

    requests = [
      {
        id: Form.ID.make("frm_new", { disableChecks: true }),
        sessionID: Session.ID.make("ses_active", { disableChecks: true }),
        title: "Input requested",
        fields: formFields,
      },
    ]
    events.disconnect()

    await wait(
      () =>
        calls === 2 &&
        data.session.form.list(Session.ID.make("ses_active", { disableChecks: true }))?.[0]?.id ===
          Form.ID.make("frm_new", { disableChecks: true }),
    )
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
          id: SessionMessage.ID.make("msg_model_1", { disableChecks: true }),
          type: "model-switched",
          previous: {
            id: "model-1",
            providerID: Provider.ID.make("provider-1", { disableChecks: true }),
            variant: "medium",
          },
          model: {
            id: Model.ID.make("model-1", { disableChecks: true }),
            providerID: Provider.ID.make("provider-1", { disableChecks: true }),
            variant: "high",
          },
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
      id: Event.ID.make("evt_agent_1", { disableChecks: true }),
      created: 0,
      type: "session.agent.selected",
      durable: durable("session-1"),
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_model_1", { disableChecks: true }),
      created: 0,
      type: "session.model.selected",
      durable: durable("session-1", 1),
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        model: {
          id: Model.ID.make("model-1", { disableChecks: true }),
          providerID: Provider.ID.make("provider-1", { disableChecks: true }),
          variant: Model.VariantID.make("high", { disableChecks: true }),
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_step_started_1", { disableChecks: true }),
      created: 0,
      type: "session.step.started",
      durable: durable("session-1", 2),
      data: {
        started: 0,
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          id: Model.ID.make("model-1", { disableChecks: true }),
          providerID: Provider.ID.make("provider-1", { disableChecks: true }),
        },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_input_1", { disableChecks: true }),
      created: 0,
      type: "session.tool.input.started",
      durable: durable("session-1", 3),
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
        id: "call-1",
        name: "bash",
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_called_1", { disableChecks: true }),
      created: 0,
      type: "session.tool.called",
      durable: durable("session-1", 4),
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
        id: "call-1",
        input: {},
        executed: false,
        state: { call: true },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_progress_1", { disableChecks: true }),
      created: 0,
      type: "session.tool.progress",
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
        id: "call-1",
        metadata: { sessionID: Session.ID.make("session-child", { disableChecks: true }), status: "running" },
      },
    })

    await wait(() => {
      const assistant = sync.session.message.get(
        Session.ID.make("session-1", { disableChecks: true }),
        SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
      )
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "running" &&
        assistant.content[0].state.metadata.sessionID === "session-child"
      )
    })

    emitEvent(events, {
      id: Event.ID.make("evt_failed_1", { disableChecks: true }),
      created: 0,
      type: "session.tool.failed",
      durable: durable("session-1", 6, 2),
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        assistantMessageID: SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
        id: "call-1",
        error: { type: "unknown", message: "aborted" },
        executed: false,
        resultState: { result: true },
      },
    })

    await wait(() => {
      const assistant = sync.session.message.get(
        Session.ID.make("session-1", { disableChecks: true }),
        SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
      )
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "error"
      )
    })

    const assistant = sync.session.message.get(
      Session.ID.make("session-1", { disableChecks: true }),
      SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }),
    )
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") return
    expect(assistant.id).toBe(SessionMessage.ID.make("msg_explicit_assistant_9", { disableChecks: true }))
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
    expect(
      sync.session.message.list(Session.ID.make("session-1", { disableChecks: true })).map((message) => message.type),
    ).toEqual(["agent-switched", "model-switched", "assistant"])
    expect(
      sync.session.message.get(
        Session.ID.make("session-1", { disableChecks: true }),
        SessionMessage.ID.make("msg_model_1", { disableChecks: true }),
      ),
    ).toMatchObject({
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
  const sessionID = Session.ID.make("session-1", { disableChecks: true })
  const messageID = SessionMessage.ID.make("msg_user_1", { disableChecks: true })
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
      id: Event.ID.make("evt_admitted_1", { disableChecks: true }),
      created: 0,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make(messageID, { disableChecks: true }),
        item: { type: "user", payload: { text: "hello" }, delivery: "steer" },
      },
    })
    await wait(() => sync.session.message.list(sessionID)?.length === 1)
    const admitted = sync.session.message.list(sessionID)?.[0]
    expect(admitted).toMatchObject({ id: messageID, ...Expected.user("hello") })
    expect(admitted?.metadata).toBeUndefined()
    expect(sync.session.pending.list(sessionID)).toEqual([
      {
        id: messageID,
        sessionID: sessionID,
        time: { created: 0 },
        type: "user",
        payload: { text: "hello" },
        delivery: "steer",
      },
    ])
    expect(sync.session.input.list(sessionID)).toEqual([messageID])

    await sync.session.message.sync(sessionID)
    expect(sync.session.message.list(sessionID)?.[0]?.metadata).toBeUndefined()

    emitEvent(events, {
      id: Event.ID.make("evt_prompted_1", { disableChecks: true }),
      created: 0,
      type: "session.inbox.delivered",
      durable: durable(sessionID, 1),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make(messageID, { disableChecks: true }),
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
    expect(sync.session.message.list(Session.ID.make("missing", { disableChecks: true }))).toEqual([])
    expect(sync.session.message.get(sessionID, messageID)).toBe(message)
    expect(
      sync.session.message.get(sessionID, SessionMessage.ID.make("missing", { disableChecks: true })),
    ).toBeUndefined()
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
      id: Event.ID.make("evt_instructions_1", { disableChecks: true }),
      created: 0,
      type: "session.instructions.updated",
      durable: durable("session-1", 0, 2),
      metadata: { instructions: { initial: true } },
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        delta: { "core/date": "0".repeat(64) },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_instructions_2", { disableChecks: true }),
      created: 1,
      type: "session.instructions.updated",
      durable: durable("session-1", 1, 2),
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        delta: { "core/date": "1".repeat(64) },
      },
    })
    emitEvent(events, {
      id: Event.ID.make("evt_instructions_3", { disableChecks: true }),
      created: 2,
      type: "session.instructions.updated",
      durable: durable("session-1", 2, 2),
      data: {
        sessionID: Session.ID.make("session-1", { disableChecks: true }),
        delta: { "core/date": "2".repeat(64) },
        text: "The current date has changed.",
      },
    })

    await wait(() =>
      sync.session.message
        .list(Session.ID.make("session-1", { disableChecks: true }))
        ?.some((message) => message.time.created === 2),
    )
    expect(sync.session.message.list(Session.ID.make("session-1", { disableChecks: true }))).toHaveLength(1)
    expect(sync.session.message.list(Session.ID.make("session-1", { disableChecks: true }))?.[0]).toMatchObject({
      id: SessionMessage.ID.fromEvent(Event.ID.make("evt_instructions_3", { disableChecks: true })),
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
    projectID: Project.ID.make("proj_test", { disableChecks: true }),
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
    await data.session.sync(Session.ID.make("root", { disableChecks: true }), { children: true })
    expect(data.session.get(Session.ID.make("root", { disableChecks: true }))?.id).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    expect(data.session.get(Session.ID.make("child", { disableChecks: true }))?.parentID).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    expect(data.session.get(Session.ID.make("sibling", { disableChecks: true }))?.parentID).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    expect(data.session.get(Session.ID.make("grandchild", { disableChecks: true }))).toBeUndefined()
    expect(data.session.family(Session.ID.make("root", { disableChecks: true }))).toEqual([
      Session.ID.make("root", { disableChecks: true }),
      Session.ID.make("child", { disableChecks: true }),
      Session.ID.make("sibling", { disableChecks: true }),
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("groups an orphan child under its missing parent until the root arrives", async () => {
  const { data, app } = await mountData({ child: "root" })
  try {
    await data.session.sync(Session.ID.make("child", { disableChecks: true }))
    // Parent info is absent, so the missing parent is the furthest-known ancestor.
    expect(data.session.root(Session.ID.make("child", { disableChecks: true }))).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    expect(data.session.family(Session.ID.make("child", { disableChecks: true }))).toEqual([
      Session.ID.make("child", { disableChecks: true }),
    ])
    expect(data.session.family(Session.ID.make("root", { disableChecks: true }))).toEqual([
      Session.ID.make("child", { disableChecks: true }),
    ])

    await data.session.sync(Session.ID.make("root", { disableChecks: true }))
    expect(data.session.root(Session.ID.make("root", { disableChecks: true }))).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    // The tentative root entry folds into the now-known root's family.
    expect(data.session.family(Session.ID.make("child", { disableChecks: true }))).toEqual([
      Session.ID.make("child", { disableChecks: true }),
      Session.ID.make("root", { disableChecks: true }),
    ])
    expect(data.session.family(Session.ID.make("root", { disableChecks: true }))).toEqual([
      Session.ID.make("child", { disableChecks: true }),
      Session.ID.make("root", { disableChecks: true }),
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("indexes arbitrarily deep nesting under a single root", async () => {
  const { data, app } = await mountData({ grandchild: "child", child: "root" })
  try {
    await data.session.sync(Session.ID.make("grandchild", { disableChecks: true }))
    expect(data.session.root(Session.ID.make("grandchild", { disableChecks: true }))).toBe(
      Session.ID.make("child", { disableChecks: true }),
    )
    expect(data.session.family(Session.ID.make("grandchild", { disableChecks: true }))).toEqual([
      Session.ID.make("grandchild", { disableChecks: true }),
    ])

    await data.session.sync(Session.ID.make("child", { disableChecks: true }))
    // grandchild's tentative family (keyed by the missing "child") merges up
    // toward the still-missing "root".
    expect(data.session.root(Session.ID.make("child", { disableChecks: true }))).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    expect(data.session.family(Session.ID.make("grandchild", { disableChecks: true }))).toEqual([
      Session.ID.make("grandchild", { disableChecks: true }),
      Session.ID.make("child", { disableChecks: true }),
    ])

    await data.session.sync(Session.ID.make("root", { disableChecks: true }))
    expect(data.session.root(Session.ID.make("grandchild", { disableChecks: true }))).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    expect(data.session.root(Session.ID.make("child", { disableChecks: true }))).toBe(
      Session.ID.make("root", { disableChecks: true }),
    )
    expect(data.session.family(Session.ID.make("root", { disableChecks: true }))).toEqual([
      Session.ID.make("grandchild", { disableChecks: true }),
      Session.ID.make("child", { disableChecks: true }),
      Session.ID.make("root", { disableChecks: true }),
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("totals family cost for roots and keeps subagent cost scoped", async () => {
  const { data, app } = await mountData({ grandchild: "child", child: "root" }, { root: 1, child: 2, grandchild: 3 })
  try {
    await data.session.sync(Session.ID.make("grandchild", { disableChecks: true }))
    await data.session.sync(Session.ID.make("child", { disableChecks: true }))
    await data.session.sync(Session.ID.make("root", { disableChecks: true }))

    expect(data.session.cost(Session.ID.make("root", { disableChecks: true }))).toBe(6)
    expect(data.session.cost(Session.ID.make("child", { disableChecks: true }))).toBe(2)
    expect(data.session.cost(Session.ID.make("grandchild", { disableChecks: true }))).toBe(3)
  } finally {
    app.renderer.destroy()
  }
})

test("re-registering an existing session is idempotent", async () => {
  const { data, app } = await mountData({ grandchild: "child", child: "root" })
  try {
    await data.session.sync(Session.ID.make("grandchild", { disableChecks: true }))
    await data.session.sync(Session.ID.make("child", { disableChecks: true }))
    await data.session.sync(Session.ID.make("root", { disableChecks: true }))
    const before = data.session.family(Session.ID.make("root", { disableChecks: true }))
    expect(before).toEqual([
      Session.ID.make("grandchild", { disableChecks: true }),
      Session.ID.make("child", { disableChecks: true }),
      Session.ID.make("root", { disableChecks: true }),
    ])

    await data.session.sync(Session.ID.make("child", { disableChecks: true }))
    await data.session.sync(Session.ID.make("root", { disableChecks: true }))
    await data.session.sync(Session.ID.make("grandchild", { disableChecks: true }))
    expect(data.session.family(Session.ID.make("root", { disableChecks: true }))).toEqual(before)
    expect(data.session.family(Session.ID.make("root", { disableChecks: true }))).toHaveLength(3)
  } finally {
    app.renderer.destroy()
  }
})

test("stops at the last non-repeating ancestor on a parent cycle", async () => {
  const { data, app } = await mountData({ x: "y", y: "x" })
  try {
    await data.session.sync(Session.ID.make("x", { disableChecks: true }))
    await data.session.sync(Session.ID.make("y", { disableChecks: true }))
    // Does not hang; walking up from "y" stops before re-entering "x".
    expect(data.session.root(Session.ID.make("y", { disableChecks: true }))).toBe(
      Session.ID.make("x", { disableChecks: true }),
    )
    expect(data.session.family(Session.ID.make("y", { disableChecks: true }))).toEqual([
      Session.ID.make("x", { disableChecks: true }),
      Session.ID.make("y", { disableChecks: true }),
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("admits prompts optimistically and reconciles with the durable echo", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-1", { disableChecks: true })
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
    const promise = sync.session.prompt({
      sessionID: Session.ID.make(sessionID, { disableChecks: true }),
      text: "hello",
    })
    const settled = promise.then(
      () => undefined,
      (error) => error,
    )

    // Optimistic: the row renders before the server responds.
    const optimistic = sync.session.pending.list(sessionID)[0]
    expect(optimistic).toMatchObject({
      sessionID: sessionID,
      type: "user",
      payload: { text: "hello" },
      delivery: "steer",
    })
    const messageID = optimistic!.id
    expect(messageID.startsWith(SessionMessage.ID.make("msg_", { disableChecks: true }))).toBe(true)
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
      id: Event.ID.make("evt_echo_1", { disableChecks: true }),
      created: 5,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make(messageID, { disableChecks: true }),
        item: { type: "user", payload: { text: "hello", files: [echoFile] }, delivery: "steer" },
      },
    })
    await wait(() => received.includes("session.inbox.enqueued"))
    unsubscribe()
    expect(sync.session.pending.list(sessionID)).toEqual([
      {
        id: messageID,
        sessionID: sessionID,
        time: { created: 5 },
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
  const sessionID = Session.ID.make("session-1", { disableChecks: true })
  const item = {
    id: SessionMessage.ID.make("msg_pending_1", { disableChecks: true }),
    sessionID: Session.ID.make(sessionID, { disableChecks: true }),
    time: { created: 5 },
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
      { id: item.id, ...Expected.user("waiting"), time: { created: 5 } },
    ])

    await sync.session.message.sync(sessionID)
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([item.id])
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the row when the response lands before the echo", async () => {
  const events = createEventStream()
  const sessionID = Session.ID.make("session-1", { disableChecks: true })
  const messageID = SessionMessage.ID.make("msg_early_1", { disableChecks: true })
  const admission = {
    id: messageID,
    sessionID: Session.ID.make(sessionID, { disableChecks: true }),
    time: { created: 1 },
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
    await sync.session.prompt({
      sessionID: Session.ID.make(sessionID, { disableChecks: true }),
      id: messageID,
      text: "hello",
    })

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
  const sessionID = Session.ID.make("session-1", { disableChecks: true })
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
    const promise = sync.session.prompt({
      sessionID: Session.ID.make(sessionID, { disableChecks: true }),
      text: "rejected",
    })
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
  const sessionID = Session.ID.make("session-1", { disableChecks: true })
  const messageID = SessionMessage.ID.make("msg_retry_1", { disableChecks: true })
  const admission = {
    id: messageID,
    sessionID: Session.ID.make(sessionID, { disableChecks: true }),
    time: { created: 1 },
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
    await sync.session.prompt({
      sessionID: Session.ID.make(sessionID, { disableChecks: true }),
      id: messageID,
      text: "hello",
    })
    // Retry with the identical payload: server admission is idempotent per ID,
    // and the local dedupe keeps a single row.
    await sync.session.prompt({
      sessionID: Session.ID.make(sessionID, { disableChecks: true }),
      id: messageID,
      text: "hello",
    })

    expect(posts).toEqual([messageID, messageID])
    expect(sync.session.pending.list(sessionID).map((item) => item.id)).toEqual([messageID])
    expect(sync.session.input.list(sessionID)).toEqual([messageID])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])

    // The row is acknowledged (echo applied): a FAILED retry under the same
    // ID must not roll back acknowledged state.
    const received: string[] = []
    const unsubscribe = sync.listen((event) => received.push(event.name))
    emitEvent(events, {
      id: Event.ID.make("evt_ack_1", { disableChecks: true }),
      created: 2,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        inboxID: SessionMessage.ID.make(messageID, { disableChecks: true }),
        item: { type: "user", payload: { text: "hello" }, delivery: "steer" },
      },
    })
    await wait(() => received.includes("session.inbox.enqueued"))
    unsubscribe()
    fail = true
    await expect(
      sync.session.prompt({
        sessionID: Session.ID.make(sessionID, { disableChecks: true }),
        id: messageID,
        text: "hello",
      }),
    ).rejects.toThrow()
    expect(sync.session.pending.list(sessionID).map((item) => item.id)).toEqual([messageID])
    expect(sync.session.message.list(sessionID).map((message) => message.id)).toEqual([messageID])
  } finally {
    app.renderer.destroy()
  }
})
