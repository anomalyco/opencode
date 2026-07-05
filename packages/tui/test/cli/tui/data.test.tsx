/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { V2Event } from "@opencode-ai/sdk/v2"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { EventV2 } from "@opencode-ai/core/event"
import { onMount } from "solid-js"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { DataProvider, useData } from "../../../src/context/data"
import { createSessionRows } from "../../../src/routes/session/rows"
import { createApi, createClient, createEventStream, createFetch, directory, json } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function emitEvent(events: ReturnType<typeof createEventStream>, event: V2Event) {
  events.emit({ ...event, location: { directory } })
}

function durable(sessionID: string, seq = 0, version = 1) {
  return { aggregateID: sessionID, seq, version }
}

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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
    expect(data.session.message.ids("ses_test")).toEqual(["msg_first", "msg_second"])
    expect(data.session.message.get("ses_test", "msg_second")?.id).toBe("msg_second")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("msg_second")
    expect(data.location.default()).toEqual({ directory, workspaceID: undefined })
    expect(data.location.agent.list(location)?.map((agent) => agent.id)).toEqual(["build"])
  } finally {
    app.renderer.destroy()
  }
})

test("reconnects the event stream and bootstraps fresh data", async () => {
  const events = createEventStream()
  const requests = { active: 0, event: 0, model: 0 }
  let resolveActive!: (response: Response) => void
  const calls = createFetch((url) => {
    if (url.pathname === "/api/event") {
      requests.event++
      return events.v2()
    }
    if (url.pathname === "/api/session/active") {
      requests.active++
      if (requests.active === 1) return json({ data: { "session-stale": { type: "running" } }, watermarks: {} })
      return new Promise<Response>((resolve) => {
        resolveActive = resolve
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

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.location.model.list()?.[0]?.id === "model-1")
    await wait(() => data.session.status("session-stale") === "running")
    expect(data.connection.status()).toBe("connected")
    expect(data.connection.attempt()).toBe(0)

    events.disconnect()
    await wait(() => data.connection.status() === "connecting")
    expect(data.connection.attempt()).toBe(1)
    expect(data.connection.error()).toBe("Event stream disconnected")

    await wait(() => requests.active === 2 && data.connection.status() === "connected", 4000)
    emitEvent(events, {
      id: "evt_step_started_after_reconnect",
      created: 1,
      type: "session.step.started",
      durable: durable("session-new"),
      data: {
        sessionID: "session-new",
        assistantMessageID: "message-new",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    await wait(() => data.session.status("session-new") === "running")
    resolveActive(json({ data: {}, watermarks: {} }))

    await wait(() => data.location.model.list()?.[0]?.id === "model-2", 4000)
    await wait(() => data.session.status("session-stale") === "idle")
    expect(data.session.status("session-new")).toBe("running")
    expect(requests.event).toBe(2)
    expect(data.connection.status()).toBe("connected")
    expect(data.connection.attempt()).toBe(0)
    expect(data.connection.error()).toBeUndefined()
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
      type: "session.prompt.admitted",
      durable: durable(sessionID, 2),
      data: {
        sessionID,
        inputID: "message-user",
        prompt: { text: "Continue" },
        delivery: "steer",
      },
    })
    await wait(() => rows.at(-1)?.type === "message")
    expect(rows.find((row) => row.type === "group")?.completed).toBe(false)

    emitEvent(events, {
      id: "evt_prompt_promoted",
      created: 4,
      type: "session.prompt.promoted",
      durable: durable(sessionID, 3),
      data: { sessionID, inputID: "message-user" },
    })
    await wait(() => rows.find((row) => row.type === "group")?.completed === true)
    expect(rows.at(-1)).toEqual({ type: "message", messageID: "message-user" })
  } finally {
    app.renderer.destroy()
  }
})

test("connectedOnce is false until first connect and persists across disconnect", async () => {
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
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => stream !== undefined)
    expect(data.connection.status()).toBe("connecting")
    expect(data.connection.connectedOnce()).toBe(false)

    connect()
    await wait(() => data.connection.status() === "connected")
    expect(data.connection.connectedOnce()).toBe(true)

    disconnect()
    await wait(() => data.connection.status() === "connecting")
    expect(data.connection.connectedOnce()).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("tracks session status from active sessions and execution events", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/active")
      return json({ data: { "session-active": { type: "running" } }, watermarks: {} })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.session.status("session-active") === "running")
    expect(data.session.status("session-idle")).toBe("idle")

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
    await wait(() => data.session.status("session-live") === "running")

    emitEvent(events, {
      id: "evt_step_ended",
      created: 0,
      type: "session.step.ended",
      durable: durable("session-live", 1, 2),
      data: {
        sessionID: "session-live",
        assistantMessageID: "message-live",
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get("session-live", "message-live")
      return assistant?.type === "assistant" && assistant.finish === "stop"
    })
    expect(data.session.status("session-live")).toBe("running")

    emitEvent(events, {
      id: "evt_execution_settled",
      created: 0,
      type: "session.execution.settled",
      data: {
        sessionID: "session-live",
        outcome: "success",
      },
    })
    await wait(() => data.session.status("session-live") === "idle")

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
    await wait(() => data.session.status("session-failed") === "running")

    emitEvent(events, {
      id: "evt_step_failed",
      created: 0,
      type: "session.step.failed",
      durable: durable("session-failed", 1, 2),
      data: {
        sessionID: "session-failed",
        assistantMessageID: "message-failed",
        error: { type: "unknown", message: "Provider unavailable" },
      },
    })
    await wait(() => {
      const assistant = data.session.message.get("session-failed", "message-failed")
      return assistant?.type === "assistant" && assistant.finish === "error"
    })
    expect(data.session.status("session-failed")).toBe("running")

    emitEvent(events, {
      id: "evt_failed_execution_settled",
      created: 0,
      type: "session.execution.settled",
      data: {
        sessionID: "session-failed",
        outcome: "failure",
        error: { type: "unknown", message: "Provider unavailable" },
      },
    })
    await wait(() => data.session.status("session-failed") === "idle")
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <box />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.connection.status() === "connected")
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

test("adds, dismisses, and refreshes form requests", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session/ses_1/form") return
    return json({ data: [{ id: "frm_remote", sessionID: "ses_1", mode: "form", fields: [] }] })
  }, events)
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => data.connection.status() === "connected")
    emitEvent(events, {
      id: "evt_form_created_1",
      created: 0,
      type: "form.created",
      data: { form: { id: "frm_1", sessionID: "ses_1", mode: "form", fields: [] } },
    })
    emitEvent(events, {
      id: "evt_form_created_duplicate",
      created: 1,
      type: "form.created",
      data: { form: { id: "frm_1", sessionID: "ses_1", mode: "form", fields: [] } },
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
      data: { form: { id: "frm_2", sessionID: "ses_1", mode: "form", fields: [] } },
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
        tool: "bash",
        input: {},
        provider: { executed: false, metadata: { fake: { call: true } } },
      },
    })
    emitEvent(events, {
      id: "evt_failed_1",
      created: 0,
      type: "session.tool.failed",
      durable: durable("session-1", 5),
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        error: { type: "unknown", message: "aborted" },
        provider: { executed: false, metadata: { fake: { result: true } } },
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
    expect(tool.state.structured).toEqual({})
    expect(tool.state.content).toEqual([])
    expect(tool.provider).toEqual({
      executed: false,
      metadata: { fake: { call: true } },
      resultMetadata: { fake: { result: true } },
    })
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

test("renders admitted prompts immediately with queued marker and clears when promoted", async () => {
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    const received: string[] = []
    const unsubscribe = sync.listen((event) => received.push(event.name))
    emitEvent(events, {
      id: "evt_admitted_1",
      created: 0,
      type: "session.prompt.admitted",
      durable: durable(sessionID),
      data: {
        sessionID,
        inputID: messageID,
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    await wait(() => sync.session.message.list(sessionID)?.length === 1)
    const admitted = sync.session.message.list(sessionID)?.[0]
    expect(admitted).toMatchObject({ id: messageID, type: "user", text: "hello", metadata: { queued: true } })

    await sync.session.message.refresh(sessionID)
    expect(sync.session.message.list(sessionID)?.[0]?.metadata?.queued).toBeUndefined()

    emitEvent(events, {
      id: "evt_prompted_1",
      created: 0,
      type: "session.prompt.promoted",
      durable: durable(sessionID, 1),
      data: {
        sessionID,
        inputID: messageID,
      },
    })

    await wait(() => received.at(-1) === "session.prompt.promoted")
    expect(received.slice(-2)).toEqual(["session.prompt.admitted", "session.prompt.promoted"])
    unsubscribe()
    const message = sync.session.message.list(sessionID)?.[0]
    expect(message?.type).toBe("user")
    if (message?.type !== "user") return
    expect(message).toMatchObject({ id: messageID, text: "hello" })
    expect(message.metadata?.queued).toBeUndefined()
    expect(sync.session.message.ids(sessionID)).toEqual([messageID])
    expect(sync.session.message.ids("missing")).toEqual([])
    expect(sync.session.message.get(sessionID, messageID)).toBe(message)
    expect(sync.session.message.get(sessionID, "missing")).toBeUndefined()
    expect(received).toHaveLength(3)
  } finally {
    app.renderer.destroy()
  }
})

test("projects live context updates with their message ID", async () => {
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    emitEvent(events, {
      id: "evt_context_1",
      created: 0,
      type: "session.context.updated",
      durable: durable("session-1"),
      data: {
        sessionID: "session-1",
        text: "Updated context",
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    expect(sync.session.message.list("session-1")?.[0]).toMatchObject({
      id: SessionMessage.ID.fromEvent(EventV2.ID.make("evt_context_1")),
      type: "system",
      text: "Updated context",
      time: { created: 0 },
    })
  } finally {
    app.renderer.destroy()
  }
})

function sessionInfo(id: string, parentID: string | undefined) {
  return {
    id,
    parentID,
    projectID: "proj_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    title: id,
    location: { directory },
  }
}

// Mounts a DataProvider whose `/api/session/:id` responses are driven by the
// given parent map (sessionID -> parentID). Roots omit the entry. Reused across
// the family-index tests below.
async function mountData(parents: Record<string, string>) {
  const calls = createFetch((url) => {
    const match = url.pathname.match(/^\/api\/session\/([^/]+)$/)
    if (match && match[1] !== "active") return json({ data: sessionInfo(match[1], parents[match[1]]) })
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
      <SDKProvider client={createClient(calls.fetch)} api={createApi(calls.fetch)}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
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
