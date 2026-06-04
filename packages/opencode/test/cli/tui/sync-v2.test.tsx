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
    events.emit(
      global({
        id: "evt_agent_1",
        type: "session.next.agent.switched",
        properties: { sessionID: "session-1", timestamp: 0, agent: "build" },
      }),
    )
    events.emit(
      global({
        id: "evt_model_1",
        type: "session.next.model.switched",
        properties: {
          sessionID: "session-1",
          timestamp: 0,
          model: { id: "model-1", providerID: "provider-1" },
        },
      }),
    )
    events.emit(
      global({
        id: "evt_assistant_1",
        type: "session.next.step.started",
        properties: {
          sessionID: "session-1",
          timestamp: 1,
          agent: "build",
          model: { id: "model-1", providerID: "provider-1" },
        },
      }),
    )
    events.emit(
      global({
        id: "evt_input_1",
        type: "session.next.tool.input.started",
        properties: {
          sessionID: "session-1",
          timestamp: 2,
          assistantMessageID: "evt_assistant_1",
          callID: "call-1",
          name: "bash",
        },
      }),
    )
    events.emit(
      global({
        id: "evt_failed_1",
        type: "session.next.tool.failed",
        properties: {
          sessionID: "session-1",
          timestamp: 3,
          assistantMessageID: "evt_assistant_1",
          callID: "call-1",
          error: { type: "unknown", message: "aborted" },
          provider: { executed: false },
        },
      }),
    )

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

test("sync v2 renders admitted prompts once before promotion", async () => {
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
    events.emit(
      global({
        id: "evt_admitted_1",
        type: "session.next.prompt.admitted",
        properties: {
          sessionID: "session-1",
          messageID: "msg_user_1",
          timestamp: 0,
          prompt: { text: "hello" },
          delivery: "steer",
        },
      }),
    )
    events.emit(
      global({
        id: "evt_promoted_1",
        type: "session.next.prompt.promoted",
        properties: { sessionID: "session-1", messageID: "msg_user_1", timestamp: 1 },
      }),
    )

    await wait(() => sync.session.message.fromSession("session-1").length === 1)
    expect(sync.session.message.fromSession("session-1").map((message) => [message.id, message.type])).toEqual([
      ["msg_user_1", "user"],
    ])
  } finally {
    app.renderer.destroy()
  }
})

test("sync v2 hydrates pending inputs without duplicating projected messages", async () => {
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/session-1/input")
      return json({ data: [{ id: "msg_pending", sessionID: "session-1", admittedSeq: 0, prompt: { text: "pending" }, delivery: "queue", timeCreated: 0 }] })
    if (url.pathname === "/api/session/session-1/message")
      return json({ data: [{ id: "msg_visible", type: "user", text: "visible", time: { created: 1 } }] })
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
    await sync.session.message.sync("session-1")
    expect(sync.session.message.fromSession("session-1").map((message) => [message.id, message.type])).toEqual([
      ["msg_visible", "user"],
      ["msg_pending", "user"],
    ])
  } finally {
    app.renderer.destroy()
  }
})
