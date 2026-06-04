/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2"
import { onMount } from "solid-js"
import { ProjectProvider } from "../../../src/cli/cmd/tui/context/project"
import { SDKProvider } from "../../../src/cli/cmd/tui/context/sdk"
import { SyncProviderV2, useSyncV2 } from "../../../src/cli/cmd/tui/context/sync-v2"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function global(payload: Event): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function emitTwice(events: ReturnType<typeof createEventSource>, payload: Event) {
  const event = global(payload)
  events.emit(event)
  events.emit(event)
}

test("sync v2 settles pending tools when a live failure arrives", async () => {
  const events = createEventSource()
  const calls = createFetch()
  let sync!: ReturnType<typeof useSyncV2>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useSyncV2()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
      <ProjectProvider>
        <SyncProviderV2>
          <Probe />
        </SyncProviderV2>
      </ProjectProvider>
    </SDKProvider>
  ))

  try {
    await mounted
    emitTwice(events, {
      id: "evt_agent_1",
      type: "session.next.agent.switched",
      properties: { sessionID: "session-1", timestamp: 0, agent: "build" },
    })
    emitTwice(events, {
      id: "evt_model_1",
      type: "session.next.model.switched",
      properties: {
        sessionID: "session-1",
        timestamp: 0,
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitTwice(events, {
      id: "evt_assistant_1",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        timestamp: 1,
        agent: "build",
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitTwice(events, {
      id: "evt_input_1",
      type: "session.next.tool.input.started",
      properties: {
        sessionID: "session-1",
        timestamp: 2,
        assistantCreatorEventID: "evt_assistant_1",
        callID: "call-1",
        name: "bash",
      },
    })
    emitTwice(events, {
      id: "evt_failed_1",
      type: "session.next.tool.failed",
      properties: {
        sessionID: "session-1",
        timestamp: 3,
        assistantCreatorEventID: "evt_assistant_1",
        callID: "call-1",
        error: { type: "unknown", message: "aborted" },
        provider: { executed: false },
      },
    })

    await wait(() => {
      const assistant = sync.session.message.fromSession("session-1")[0]
      return (
        assistant?.type === "assistant" &&
        assistant.content[0]?.type === "tool" &&
        assistant.content[0].state.status === "error"
      )
    })

    const assistant = sync.session.message.fromSession("session-1")[0]
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") return
    const tool = assistant.content[0]
    expect(tool?.type).toBe("tool")
    if (tool?.type !== "tool") return
    expect(tool.state.status).toBe("error")
    if (tool.state.status !== "error") return
    expect(tool.state.error).toEqual({ type: "unknown", message: "aborted" })
    expect(tool.state.input).toEqual({})
    expect(tool.state.structured).toEqual({})
    expect(tool.state.content).toEqual([])
    expect(sync.session.message.fromSession("session-1").map((message) => message.type)).toEqual([
      "assistant",
      "model-switched",
      "agent-switched",
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("sync v2 renders admitted prompts only after promotion", async () => {
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message")
      return json({ data: [{ id: "msg_user_1", type: "user", text: "hello", time: { created: 0 } }] })
    return undefined
  })
  let sync!: ReturnType<typeof useSyncV2>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useSyncV2()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
      <ProjectProvider>
        <SyncProviderV2>
          <Probe />
        </SyncProviderV2>
      </ProjectProvider>
    </SDKProvider>
  ))

  try {
    await mounted
    emitTwice(events, {
      id: "evt_admitted_1",
      type: "session.next.prompt.admitted",
      properties: {
        sessionID: "session-1",
        messageID: "msg_user_1",
        timestamp: 0,
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    expect(sync.session.message.fromSession("session-1")).toEqual([])

    emitTwice(events, {
      id: "evt_promoted_1",
      type: "session.next.prompt.promoted",
      properties: { sessionID: "session-1", messageID: "msg_user_1", timestamp: 1 },
    })

    await wait(() => sync.session.message.fromSession("session-1").length === 1)
    const message = sync.session.message.fromSession("session-1")[0]
    expect(message?.type).toBe("user")
    if (message?.type !== "user") return
    expect(message).toMatchObject({ id: "msg_user_1", text: "hello" })
  } finally {
    app.renderer.destroy()
  }
})

test("sync v2 hydrates a promoted prompt when admission was missed", async () => {
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message")
      return json({ data: [{ id: "msg_user_1", type: "user", text: "hello", time: { created: 0 } }] })
    return undefined
  })
  let sync!: ReturnType<typeof useSyncV2>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useSyncV2()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
      <ProjectProvider>
        <SyncProviderV2>
          <Probe />
        </SyncProviderV2>
      </ProjectProvider>
    </SDKProvider>
  ))

  try {
    await mounted
    emitTwice(events, {
      id: "evt_promoted_1",
      type: "session.next.prompt.promoted",
      properties: { sessionID: "session-1", messageID: "msg_user_1", timestamp: 1 },
    })

    await wait(() => sync.session.message.fromSession("session-1").length === 1)
    expect(sync.session.message.fromSession("session-1")[0]?.id).toBe("msg_user_1")
  } finally {
    app.renderer.destroy()
  }
})

test("sync v2 retries hydration when promotion arrives in flight", async () => {
  const events = createEventSource()
  const stale = Promise.withResolvers<Response>()
  let requests = 0
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session/session-1/message") return undefined
    requests += 1
    if (requests === 1) return stale.promise
    return json({ data: [{ id: "msg_user_1", type: "user", text: "hello", time: { created: 0 } }] })
  })
  let sync!: ReturnType<typeof useSyncV2>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useSyncV2()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
      <ProjectProvider>
        <SyncProviderV2>
          <Probe />
        </SyncProviderV2>
      </ProjectProvider>
    </SDKProvider>
  ))

  try {
    await mounted
    const hydration = sync.session.message.sync("session-1")
    await wait(() => requests === 1)
    emitTwice(events, {
      id: "evt_promoted_1",
      type: "session.next.prompt.promoted",
      properties: { sessionID: "session-1", messageID: "msg_user_1", timestamp: 1 },
    })
    stale.resolve(json({ data: [] }))
    await hydration

    await wait(() => sync.session.message.fromSession("session-1").length === 1)
    expect(sync.session.message.fromSession("session-1")[0]?.id).toBe("msg_user_1")
  } finally {
    app.renderer.destroy()
  }
})

test("sync v2 preserves live text while promotion hydration is in flight", async () => {
  const events = createEventSource()
  const response = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/message") return response.promise
    return undefined
  })
  let sync!: ReturnType<typeof useSyncV2>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    sync = useSyncV2()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
      <ProjectProvider>
        <SyncProviderV2>
          <Probe />
        </SyncProviderV2>
      </ProjectProvider>
    </SDKProvider>
  ))

  try {
    await mounted
    emitTwice(events, {
      id: "evt_promoted_1",
      type: "session.next.prompt.promoted",
      properties: { sessionID: "session-1", messageID: "msg_user_1", timestamp: 1 },
    })
    emitTwice(events, {
      id: "evt_assistant_1",
      type: "session.next.step.started",
      properties: {
        sessionID: "session-1",
        timestamp: 2,
        agent: "build",
        model: { id: "model-1", providerID: "provider-1" },
      },
    })
    emitTwice(events, {
      id: "evt_text_started_1",
      type: "session.next.text.started",
      properties: { sessionID: "session-1", timestamp: 3, textID: "text-1" },
    })
    emitTwice(events, {
      id: "evt_text_delta_1",
      type: "session.next.text.delta",
      properties: { sessionID: "session-1", timestamp: 4, textID: "text-1", delta: "Hello" },
    })
    await wait(() => {
      const message = sync.session.message.fromSession("session-1")[0]
      return message?.type === "assistant" && message.content[0]?.type === "text" && message.content[0].text === "Hello"
    })
    const live = sync.session.message.fromSession("session-1")[0]
    expect(live?.type).toBe("assistant")
    if (live?.type !== "assistant") return
    expect(live.id).toBe("msg_assistant_1")
    expect(live.content[0]).toMatchObject({ type: "text", text: "Hello" })

    response.resolve(
      json({
        data: [
          {
            id: "msg_assistant_1",
            type: "assistant",
            agent: "build",
            model: { id: "model-1", providerID: "provider-1" },
            content: [{ type: "text", id: "text-1", text: "" }],
            time: { created: 2 },
          },
          { id: "msg_user_1", type: "user", text: "hello", time: { created: 1 } },
        ],
      }),
    )

    await wait(() => sync.session.message.fromSession("session-1").length === 2)
    const assistant = sync.session.message.fromSession("session-1")[0]
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type !== "assistant") return
    expect(assistant.content[0]).toMatchObject({ type: "text", text: "Hello" })
  } finally {
    app.renderer.destroy()
  }
})
