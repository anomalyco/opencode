/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client"
import { createEffect, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider as DataProviderBase, useData } from "../../../src/context/data"
import { LocationProvider, useLocation } from "../../../src/context/location"
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

function SyncLocation() {
  const data = useData()
  const location = useLocation()
  createEffect(() => location.set(data.location.default()))
  return null
}

function durable(sessionID: string, seq = 0): { aggregateID: string; seq: number; version: 1 } {
  return { aggregateID: sessionID, seq, version: 1 }
}

type Harness = {
  data: ReturnType<typeof useData>
  client: ReturnType<typeof useClient>
}

async function renderData(fetch: ReturnType<typeof createFetch>["fetch"]) {
  const harness = {} as Harness

  function Probe() {
    harness.client = useClient()
    harness.data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(fetch)}>
        <DataProvider>
          <Probe />
        </DataProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))
  await wait(() => harness.client.connection.status() === "connected")
  return { app, ...harness }
}

test("echoes an optimistic prompt and replaces it with the admission echo", async () => {
  const events = createEventStream()
  const sessionID = "session-optimistic-echo"
  const calls = createFetch(undefined, events)
  const { app, data } = await renderData(calls.fetch)

  try {
    data.session.optimistic.prompt({
      sessionID,
      messageID: "msg_optimistic",
      delivery: "steer",
      text: "Hello",
      files: [{ data: "", mime: "text/plain", source: { type: "uri", uri: "file:///tmp/a.ts" }, name: "a.ts" }],
    })

    const echoed = data.session.message.get(sessionID, "msg_optimistic")
    expect(echoed?.type === "user" && echoed.text).toBe("Hello")
    expect(echoed?.type === "user" && echoed.files?.[0]?.data).toBe("")
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["msg_optimistic"])
    expect(data.session.input.has(sessionID, "msg_optimistic")).toBe(true)

    // Admission materializes attachments, so the echo must be replaced in place.
    emitEvent(events, {
      id: "evt_admitted",
      created: 9,
      type: "session.inbox.enqueued",
      durable: durable(sessionID),
      data: {
        sessionID,
        inboxID: "msg_optimistic",
        item: {
          type: "user",
          payload: {
            text: "Hello",
            files: [{ data: "QUJD", mime: "text/plain", source: { type: "uri", uri: "file:///tmp/a.ts" }, name: "a.ts" }],
          },
          delivery: "steer",
        },
      },
    })
    await wait(() => {
      const message = data.session.message.get(sessionID, "msg_optimistic")
      return message?.type === "user" && message.files?.[0]?.data === "QUJD"
    })
    expect(data.session.message.list(sessionID)).toHaveLength(1)
    expect(data.session.pending.list(sessionID)).toHaveLength(1)
    expect(data.session.pending.list(sessionID)[0]?.timeCreated).toBe(9)
  } finally {
    app.renderer.destroy()
  }
})

test("rolls back a failed optimistic prompt", async () => {
  const events = createEventStream()
  const sessionID = "session-optimistic-rollback"
  const calls = createFetch(undefined, events)
  const { app, data } = await renderData(calls.fetch)

  try {
    data.session.optimistic.prompt({
      sessionID,
      messageID: "msg_failed",
      delivery: "queue",
      text: "Will fail",
    })
    expect(data.session.message.get(sessionID, "msg_failed")).toBeDefined()

    data.session.optimistic.rollback(sessionID, "msg_failed")
    expect(data.session.message.get(sessionID, "msg_failed")).toBeUndefined()
    expect(data.session.pending.list(sessionID)).toHaveLength(0)
    expect(data.session.input.has(sessionID, "msg_failed")).toBe(false)

    // Rollback of an unknown or already-settled echo is a no-op.
    data.session.optimistic.rollback(sessionID, "msg_failed")
    expect(data.session.message.list(sessionID)).toHaveLength(0)
  } finally {
    app.renderer.destroy()
  }
})

test("optimistic prompts survive sync replaces until the server confirms them", async () => {
  const events = createEventStream()
  const sessionID = "session-optimistic-sync"
  let serverMessages: SessionMessageInfo[] = []
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: serverMessages, cursor: {} })
    if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
  }, events)
  const { app, data } = await renderData(calls.fetch)

  try {
    data.session.optimistic.prompt({
      sessionID,
      messageID: "msg_pending",
      delivery: "steer",
      text: "Survive the sync",
    })

    // A wholesale replace from an empty server page keeps the unconfirmed echo.
    await data.session.message.sync(sessionID)
    expect(data.session.message.get(sessionID, "msg_pending")).toBeDefined()

    await data.session.pending.sync(sessionID)
    expect(data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["msg_pending"])
    expect(data.session.input.has(sessionID, "msg_pending")).toBe(true)

    // A fetched page containing the ID is server confirmation: the projected copy
    // wins and later rollback attempts become no-ops.
    serverMessages = [{ id: "msg_pending", type: "user", text: "Survive the sync", time: { created: 5 } }]
    data.session.message.invalidate(sessionID)
    await data.session.message.sync(sessionID)
    const confirmed = data.session.message.get(sessionID, "msg_pending")
    expect(confirmed?.type === "user" && confirmed.time.created).toBe(5)
    expect(data.session.message.list(sessionID)).toHaveLength(1)

    data.session.optimistic.rollback(sessionID, "msg_pending")
    expect(data.session.message.get(sessionID, "msg_pending")).toBeDefined()
  } finally {
    app.renderer.destroy()
  }
})

test("cancellation clears the optimistic echo for good", async () => {
  const events = createEventStream()
  const sessionID = "session-optimistic-cancel"
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
  }, events)
  const { app, data } = await renderData(calls.fetch)

  try {
    data.session.optimistic.prompt({
      sessionID,
      messageID: "msg_cancelled",
      delivery: "queue",
      text: "Cancel me",
    })
    emitEvent(events, {
      id: "evt_cancelled",
      created: 2,
      type: "session.inbox.cancelled",
      durable: durable(sessionID),
      data: { sessionID, inboxID: "msg_cancelled" },
    })
    await wait(() => data.session.message.get(sessionID, "msg_cancelled") === undefined)
    expect(data.session.pending.list(sessionID)).toHaveLength(0)

    // The ledger entry is gone too: a sync replace must not resurrect the echo.
    await data.session.message.sync(sessionID)
    expect(data.session.message.get(sessionID, "msg_cancelled")).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("optimistic session creation seeds info and suppresses initial reads", async () => {
  const events = createEventStream()
  const sessionID = "ses_optimistic"
  const fetched: string[] = []
  const calls = createFetch((url) => {
    if (!url.pathname.startsWith(`/api/session/${sessionID}`)) return
    fetched.push(url.pathname)
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "proj_test",
          location: { directory },
          agent: "build",
          title: "Server title",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        },
      })
  }, events)
  const { app, data } = await renderData(calls.fetch)

  try {
    data.session.optimistic.create({
      sessionID,
      projectID: "proj_test",
      location: { directory },
      agent: "build",
      model: { providerID: "provider", id: "model" },
    })
    const seeded = data.session.get(sessionID)
    expect(seeded?.projectID).toBe("proj_test")
    expect(seeded?.agent).toBe("build")

    // Seeded reads are marked complete: the server does not know the session yet.
    await data.session.sync(sessionID, { children: true })
    await data.session.message.sync(sessionID)
    await data.session.pending.sync(sessionID)
    expect(fetched).toEqual([])

    // The session.created echo invalidates the info read and loads server truth.
    emitEvent(events, {
      id: "evt_created",
      created: 2,
      type: "session.created",
      durable: durable(sessionID),
      data: {
        sessionID,
        projectID: "proj_test",
        location: { directory },
        slug: "server-slug",
        agent: "build",
        version: "test",
      },
    })
    await wait(() => data.session.get(sessionID)?.title === "Server title")
    expect(fetched).toEqual([`/api/session/${sessionID}`])
  } finally {
    app.renderer.destroy()
  }
})

test("rollbackCreate removes the seeded session and re-enables reads", async () => {
  const events = createEventStream()
  const sessionID = "ses_rollback"
  const fetched: string[] = []
  const calls = createFetch((url) => {
    if (url.pathname !== `/api/session/${sessionID}/message`) return
    fetched.push(url.pathname)
    return json({ data: [], cursor: {} })
  }, events)
  const { app, data } = await renderData(calls.fetch)

  try {
    data.session.optimistic.create({
      sessionID,
      projectID: "proj_test",
      location: { directory },
    })
    data.session.optimistic.prompt({
      sessionID,
      messageID: "msg_first",
      delivery: "steer",
      text: "First prompt",
    })
    expect(data.session.message.list(sessionID)).toHaveLength(1)

    data.session.optimistic.rollback(sessionID, "msg_first")
    data.session.optimistic.rollbackCreate(sessionID)
    expect(data.session.get(sessionID)).toBeUndefined()
    expect(data.session.message.list(sessionID)).toHaveLength(0)
    expect(data.session.pending.list(sessionID)).toHaveLength(0)

    // The seed's completed read markers are gone with it.
    await data.session.message.sync(sessionID)
    expect(fetched).toEqual([`/api/session/${sessionID}/message`])
  } finally {
    app.renderer.destroy()
  }
})

test("revert commit preserves unconfirmed optimistic prompts", async () => {
  const events = createEventStream()
  const sessionID = "session-optimistic-revert"
  const calls = createFetch(undefined, events)
  const { app, data } = await renderData(calls.fetch)

  try {
    for (const [seq, id] of [
      [0, "msg_1"],
      [1, "msg_2"],
    ] as const) {
      emitEvent(events, {
        id: `evt_seed_${id}`,
        created: seq + 1,
        type: "session.inbox.enqueued",
        durable: durable(sessionID, seq),
        data: { sessionID, inboxID: id, item: { type: "user", payload: { text: id }, delivery: "steer" } },
      })
    }
    await wait(() => data.session.message.list(sessionID).length === 2)

    data.session.optimistic.prompt({
      sessionID,
      messageID: "msg_9",
      delivery: "steer",
      text: "After the revert boundary",
    })

    emitEvent(events, {
      id: "evt_revert",
      created: 4,
      type: "session.revert.committed",
      durable: durable(sessionID, 2),
      data: { sessionID, to: "msg_2" },
    })
    await wait(() => data.session.message.get(sessionID, "msg_2") === undefined)
    expect(data.session.message.get(sessionID, "msg_1")).toBeDefined()
    expect(data.session.message.get(sessionID, "msg_9")).toBeDefined()
    expect(data.session.input.has(sessionID, "msg_9")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
