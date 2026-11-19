/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { OpenCodeEvent } from "@opencode/client"
import { createEffect, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider as DataProviderBase, useData } from "../../../src/context/data"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { createSessionRows } from "../../../src/routes/session/rows"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

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

const config = createTuiResolvedConfig({ session: { verbosity: "medium" } })

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

function SyncLocation() {
  const data = useData()
  const location = useLocation()
  createEffect(() => location.set(data.location.default()))
  return null
}

// session.moved inserts a location-switched message; rows.ts has no live subscription for it,
// so only a rebuild triggered by the message list can show it.
test("shows the location-switched message a session move inserts", async () => {
  const events = createEventStream()
  const sessionID = "ses_moved"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Moved",
          location: { directory },
        },
      })
    if (url.pathname === `/api/session/${sessionID}/message`)
      return json({
        data: [{ id: "msg_first", type: "user", text: "First", time: { created: 1 } }],
        cursor: {},
      })
  }, events)
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>
  let rows!: ReturnType<typeof createSessionRows>
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
        <DataProvider>
          <Probe />
        </DataProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => client.connection.status() === "connected")
    await wait(() => synced)
    await data.session.sync(sessionID)
    // The runner's move delivery: the move inbox item is admitted, delivered, then session.moved follows.
    emitEvent(events, {
      id: "evt_move_enqueued",
      created: 3,
      type: "session.inbox.enqueued",
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: {
        sessionID,
        inboxID: "msg_move",
        item: {
          type: "move",
          delivery: "steer",
          payload: { location: { directory: "/tmp/elsewhere" }, projectID: "proj_test" },
        },
      },
    } as OpenCodeEvent)
    await wait(() => data.session.pending.list(sessionID).some((item) => item.id === "msg_move"))
    emitEvent(events, {
      id: "evt_move_delivered",
      created: 4,
      type: "session.inbox.delivered",
      durable: { aggregateID: sessionID, seq: 2, version: 1 },
      data: { sessionID, inboxID: "msg_move" },
    } as OpenCodeEvent)
    emitEvent(events, {
      id: "evt_moved",
      created: 5,
      type: "session.moved",
      durable: { aggregateID: sessionID, seq: 3, version: 1 },
      data: { sessionID, location: { directory: "/tmp/elsewhere" }, projectID: "proj_test" },
    } as OpenCodeEvent)
    await wait(() => data.session.message.get(sessionID, "msg_moved") !== undefined)
    expect(rows.some((row) => row.type === "message" && row.messageID === "msg_moved")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

// The client has no live handler for session.skill.activated, so a skill message reaches the store only through a
// message read. Interrupting a run while a tool is still running re-reads the newest page (data.ts execution handler).
test("shows a skill message that a session refresh reads back after an interrupted run", async () => {
  const events = createEventStream()
  const sessionID = "ses_skill"
  const model = { id: "model", providerID: "provider" }
  const user = { id: "msg_001", type: "user", text: "Use the skill", time: { created: 1 } }
  const assistant = (status: "running" | "error") => ({
    id: "msg_002",
    type: "assistant",
    agent: "build",
    model,
    time: { created: 2 },
    content: [
      {
        type: "tool",
        id: "call_1",
        name: "bash",
        time: { created: 2 },
        state:
          status === "running"
            ? { status: "running", input: {}, metadata: {} }
            : { status: "error", input: {}, error: { type: "unknown", message: "interrupted" } },
      },
    ],
  })
  const skill = {
    id: "msg_003",
    type: "skill",
    skill: "review",
    name: "review",
    text: "Skill body",
    time: { created: 3 },
  }
  const idle = { id: "msg_idle", type: "idle", outcome: "interrupted", time: { created: 10 } }
  let interrupted = false
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`)
      return json({
        data: (interrupted ? [user, assistant("error"), skill, idle] : [user, assistant("running")]).toReversed(),
        cursor: {},
      })
  }, events)
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>
  let rows!: ReturnType<typeof createSessionRows>
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
        <DataProvider>
          <Probe />
        </DataProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  try {
    await wait(() => client.connection.status() === "connected")
    await wait(() => synced)
    interrupted = true
    emitEvent(events, {
      id: "evt_idle",
      created: 10,
      type: "session.execution.interrupted",
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID, reason: "user" },
    } as OpenCodeEvent)
    await wait(() => data.session.message.get(sessionID, "msg_idle") !== undefined)
    expect(rows.some((row) => row.type === "message" && row.messageID === "msg_003")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
