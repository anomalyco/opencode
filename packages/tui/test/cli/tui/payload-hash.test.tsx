/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { onMount, type ParentProps } from "solid-js"
import { createEffect } from "solid-js"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider as DataProviderBase, useData } from "../../../src/context/data"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"

const payloadHash = "a".repeat(64)

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

function durable(sessionID: string, seq = 0) {
  return { aggregateID: sessionID, seq, version: 1 as const }
}

function DataProvider(props: ParentProps) {
  return (
    <DataProviderBase>
      <LocationProvider>
        <SyncLocation />
        {props.children}
      </LocationProvider>
    </DataProviderBase>
  )
}

function SyncLocation() {
  const data = useData()
  const location = useLocation()
  createEffect(() => location.set(data.location.default()))
  return null
}

function ProjectProvider(props: ParentProps) {
  return props.children
}

describe("payloadHash refetch", () => {
  test("tool.success with payloadHash refetches the assistant message", async () => {
    const events = createEventStream()
    const sessionID = "ses_payload_tool"
    const assistantMessageID = "msg_assistant_tool"
    const messageHits: string[] = []
    const fullContent = [{ type: "text" as const, text: "full-from-fetch" }]
    const calls = createFetch((url) => {
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/message/${assistantMessageID}`) {
        messageHits.push(url.pathname)
        return json({
          data: {
            id: assistantMessageID,
            type: "assistant",
            parentID: "msg_user",
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [
              {
                type: "tool",
                callID: "call-1",
                tool: "read",
                state: {
                  status: "completed",
                  input: {},
                  structured: { source: "fetch" },
                  content: fullContent,
                },
                time: { start: 1, completed: 2 },
              },
            ],
            time: { created: 1 },
          },
        })
      }
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
        id: "evt_step",
        created: 1,
        type: "session.step.started",
        durable: durable(sessionID),
        data: {
          sessionID,
          assistantMessageID,
          agent: "build",
          model: { id: "model", providerID: "provider" },
        },
      })
      emitEvent(events, {
        id: "evt_input",
        created: 2,
        type: "session.tool.input.started",
        durable: durable(sessionID, 1),
        data: { sessionID, assistantMessageID, callID: "call-1", name: "read" },
      })
      emitEvent(events, {
        id: "evt_called",
        created: 3,
        type: "session.tool.called",
        durable: durable(sessionID, 2),
        data: { sessionID, assistantMessageID, callID: "call-1", input: {}, executed: false },
      })
      await wait(() => {
        const assistant = data.session.message.get(sessionID, assistantMessageID)
        return assistant?.type === "assistant" && assistant.content[0]?.type === "tool"
      })

      emitEvent(events, {
        id: "evt_success",
        created: 4,
        type: "session.tool.success",
        durable: durable(sessionID, 3),
        data: {
          sessionID,
          assistantMessageID,
          callID: "call-1",
          structured: {},
          content: [{ type: "text", text: "preview" }],
          executed: false,
          payloadHash,
        },
      })

      await wait(() => messageHits.length === 1)
      await wait(() => {
        const assistant = data.session.message.get(sessionID, assistantMessageID)
        return (
          assistant?.type === "assistant" &&
          assistant.content[0]?.type === "tool" &&
          assistant.content[0].state.status === "completed" &&
          assistant.content[0].state.structured.source === "fetch"
        )
      })
      expect(messageHits).toEqual([`/api/session/${sessionID}/message/${assistantMessageID}`])
    } finally {
      app.renderer.destroy()
    }
  })

  test("input.admitted with payloadHash refetches pending", async () => {
    const events = createEventStream()
    const sessionID = "ses_payload_admit"
    const inputID = "msg_user_attach"
    const pendingHits: string[] = []
    const calls = createFetch((url) => {
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/pending`) {
        pendingHits.push(url.pathname)
        return json({
          data: [
            {
              id: inputID,
              sessionID,
              type: "user",
              delivery: "steer",
              admittedSeq: 1,
              timeCreated: 1,
              data: {
                text: "see file",
                files: [
                  {
                    data: "full-bytes",
                    mime: "text/plain",
                    source: { type: "uri", uri: "file:///tmp/a.txt" },
                    name: "a.txt",
                  },
                ],
              },
            },
          ],
        })
      }
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
        id: "evt_admit",
        created: 1,
        type: "session.input.admitted",
        durable: durable(sessionID, 1),
        data: {
          sessionID,
          inputID,
          payloadHash,
          input: {
            type: "user",
            delivery: "steer",
            data: {
              text: "see file",
              files: [
                {
                  data: "",
                  mime: "text/plain",
                  source: { type: "uri", uri: "file:///tmp/a.txt" },
                  name: "a.txt",
                },
              ],
            },
          },
        },
      })

      await wait(() => pendingHits.length === 1)
      await wait(() => {
        const message = data.session.message.get(sessionID, inputID)
        return message?.type === "user" && message.files?.[0]?.data === "full-bytes"
      })
      expect(pendingHits).toEqual([`/api/session/${sessionID}/pending`])
    } finally {
      app.renderer.destroy()
    }
  })

  test("thin events without payloadHash do not refetch message or pending", async () => {
    const events = createEventStream()
    const sessionID = "ses_payload_none"
    const assistantMessageID = "msg_assistant_none"
    const inputID = "msg_user_none"
    const hits: string[] = []
    const calls = createFetch((url) => {
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (
        url.pathname === `/api/session/${sessionID}/message/${assistantMessageID}` ||
        url.pathname === `/api/session/${sessionID}/pending`
      ) {
        hits.push(url.pathname)
      }
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
        id: "evt_admit",
        created: 1,
        type: "session.input.admitted",
        durable: durable(sessionID, 1),
        data: {
          sessionID,
          inputID,
          input: { type: "user", delivery: "steer", data: { text: "hello" } },
        },
      })
      await wait(() => data.session.message.get(sessionID, inputID)?.type === "user")

      emitEvent(events, {
        id: "evt_step",
        created: 2,
        type: "session.step.started",
        durable: durable(sessionID, 2),
        data: {
          sessionID,
          assistantMessageID,
          agent: "build",
          model: { id: "model", providerID: "provider" },
        },
      })
      emitEvent(events, {
        id: "evt_input",
        created: 3,
        type: "session.tool.input.started",
        durable: durable(sessionID, 3),
        data: { sessionID, assistantMessageID, callID: "call-1", name: "read" },
      })
      emitEvent(events, {
        id: "evt_called",
        created: 4,
        type: "session.tool.called",
        durable: durable(sessionID, 4),
        data: { sessionID, assistantMessageID, callID: "call-1", input: {}, executed: false },
      })
      emitEvent(events, {
        id: "evt_success",
        created: 5,
        type: "session.tool.success",
        durable: durable(sessionID, 5),
        data: {
          sessionID,
          assistantMessageID,
          callID: "call-1",
          structured: {},
          content: [{ type: "text", text: "inline" }],
          executed: false,
        },
      })
      await wait(() => {
        const assistant = data.session.message.get(sessionID, assistantMessageID)
        return (
          assistant?.type === "assistant" &&
          assistant.content[0]?.type === "tool" &&
          assistant.content[0].state.status === "completed"
        )
      })
      await Bun.sleep(50)
      expect(hits).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })
})
