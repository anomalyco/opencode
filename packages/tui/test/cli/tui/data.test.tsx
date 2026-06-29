/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { V2Event } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { DataProvider, useData } from "../../../src/context/data"
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
          { id: "msg_second", type: "user", text: "Second", time: { created: 2 } },
          { id: "msg_first", type: "user", text: "First", time: { created: 1 } },
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
  const requests = { event: 0, model: 0 }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/event") {
      requests.event++
      return events.v2()
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
    expect(data.connection.status()).toBe("connected")
    expect(data.connection.attempt()).toBe(0)

    events.disconnect()
    await wait(() => data.connection.status() === "reconnecting")
    expect(data.connection.attempt()).toBe(1)
    expect(data.connection.error()).toBe("Event stream disconnected")

    await wait(() => data.location.model.list()?.[0]?.id === "model-2", 4000)
    expect(requests.event).toBe(2)
    expect(data.connection.status()).toBe("connected")
    expect(data.connection.attempt()).toBe(0)
    expect(data.connection.error()).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("tracks session status from active sessions and execution events", async () => {
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/active") return json({ data: { "session-active": { type: "running" } } })
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
      type: "session.next.step.started",
      data: {
        sessionID: "session-live",
        assistantMessageID: "message-live",
        timestamp: 1,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    await wait(() => data.session.status("session-live") === "running")

    emitEvent(events, {
      id: "evt_step_ended",
      type: "session.next.step.ended",
      data: {
        sessionID: "session-live",
        assistantMessageID: "message-live",
        timestamp: 2,
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    await wait(() => data.session.status("session-live") === "idle")

    emitEvent(events, {
      id: "evt_failed_step_started",
      type: "session.next.step.started",
      data: {
        sessionID: "session-failed",
        assistantMessageID: "message-failed",
        timestamp: 3,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    await wait(() => data.session.status("session-failed") === "running")

    emitEvent(events, {
      id: "evt_step_failed",
      type: "session.next.step.failed",
      data: {
        sessionID: "session-failed",
        assistantMessageID: "message-failed",
        timestamp: 4,
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

    emitEvent(events, { id: "evt_integration", type: "integration.updated", data: {} })
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
    emitEvent(events, { id: "evt_catalog", type: "catalog.updated", data: {} })
    await wait(() => requests.model > before.model && requests.provider > before.provider)
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
    emitEvent(events, { id: "evt_reference_1", type: "reference.updated", data: {} })
    await wait(() => data.location.reference.list()?.length === 1)
    expect(data.location.reference.list()?.[0]?.name).toBe("docs")
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
      type: "permission.v2.replied",
      data: { sessionID: "ses_1", requestID: "per_1", reply: "once" },
    })
    await wait(() => data.session.permission.list("ses_1")?.length === 1)
    expect(data.session.permission.list("ses_1")?.[0]?.id).toBe("per_2")

    emitEvent(events, {
      id: "evt_permission_replied_2",
      type: "permission.v2.replied",
      data: { sessionID: "ses_1", requestID: "per_2", reply: "reject" },
    })
    await wait(() => data.session.permission.list("ses_1")?.length === 0)
  } finally {
    app.renderer.destroy()
  }
})

test("adds and dismisses question requests from live events", async () => {
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
      id: "evt_question_asked_1",
      type: "question.v2.asked",
      data: {
        id: "que_1",
        sessionID: "ses_1",
        questions: [{ question: "Which option?", header: "Option", options: [], multiple: false }],
      },
    })
    emitEvent(events, {
      id: "evt_question_asked_2",
      type: "question.v2.asked",
      data: {
        id: "que_2",
        sessionID: "ses_1",
        questions: [{ question: "Which environment?", header: "Environment", options: [], multiple: false }],
      },
    })
    await wait(() => data.session.question.list("ses_1")?.length === 2)

    emitEvent(events, {
      id: "evt_question_replied_1",
      type: "question.v2.replied",
      data: { sessionID: "ses_1", requestID: "que_1", answers: [["First"]] },
    })
    await wait(() => data.session.question.list("ses_1")?.length === 1)
    expect(data.session.question.list("ses_1")?.[0]?.id).toBe("que_2")

    emitEvent(events, {
      id: "evt_question_rejected_2",
      type: "question.v2.rejected",
      data: { sessionID: "ses_1", requestID: "que_2" },
    })
    await wait(() => data.session.question.list("ses_1")?.length === 0)
  } finally {
    app.renderer.destroy()
  }
})

test("settles pending tools when a live failure arrives", async () => {
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
      id: "evt_agent_1",
      type: "session.next.agent.switched",
      data: { sessionID: "session-1", messageID: "msg_agent_1", timestamp: 0, agent: "build" },
    })
    emitEvent(events, {
      id: "evt_model_1",
      type: "session.next.model.switched",
      data: {
        sessionID: "session-1",
        messageID: "msg_model_1",
        timestamp: 0,
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitEvent(events, {
      id: "evt_step_started_1",
      type: "session.next.step.started",
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        timestamp: 1,
        agent: "build",
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitEvent(events, {
      id: "evt_input_1",
      type: "session.next.tool.input.started",
      data: {
        sessionID: "session-1",
        assistantMessageID: "msg_explicit_assistant_9",
        timestamp: 2,
        callID: "call-1",
        name: "bash",
      },
    })
    emitEvent(events, {
      id: "evt_called_1",
      type: "session.next.tool.called",
      data: {
        sessionID: "session-1",
        timestamp: 2,
        assistantMessageID: "msg_explicit_assistant_9",
        callID: "call-1",
        tool: "bash",
        input: {},
        provider: { executed: false, metadata: { fake: { call: true } } },
      },
    })
    emitEvent(events, {
      id: "evt_failed_1",
      type: "session.next.tool.failed",
      data: {
        sessionID: "session-1",
        timestamp: 3,
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
  } finally {
    app.renderer.destroy()
  }
})

test("renders admitted prompts only after they become model-visible", async () => {
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
    const received: string[] = []
    const unsubscribe = sync.listen((event) => received.push(event.name))
    emitEvent(events, {
      id: "evt_admitted_1",
      type: "session.next.prompt.admitted",
      data: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 0,
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    expect(sync.session.message.list("session-1") ?? []).toEqual([])

    emitEvent(events, {
      id: "evt_prompted_1",
      type: "session.next.prompted",
      data: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 0,
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    expect(received.slice(-2)).toEqual(["session.next.prompt.admitted", "session.next.prompted"])
    unsubscribe()
    const message = sync.session.message.list("session-1")?.[0]
    expect(message?.type).toBe("user")
    if (message?.type !== "user") return
    expect(message).toMatchObject({ id: "msg_user_1", text: "hello" })
    expect(sync.session.message.ids("session-1")).toEqual(["msg_user_1"])
    expect(sync.session.message.ids("missing")).toEqual([])
    expect(sync.session.message.get("session-1", "msg_user_1")).toBe(message)
    expect(sync.session.message.get("session-1", "missing")).toBeUndefined()
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
      type: "session.next.context.updated",
      data: {
        sessionID: "session-1",
        messageID: "msg_context_1",
        timestamp: 1,
        text: "Updated context",
      },
    })

    await wait(() => sync.session.message.list("session-1")?.length === 1)
    expect(sync.session.message.list("session-1")?.[0]).toMatchObject({
      id: "msg_context_1",
      type: "system",
      text: "Updated context",
    })
  } finally {
    app.renderer.destroy()
  }
})
