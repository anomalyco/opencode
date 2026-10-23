import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInfo } from "../src/promise"

const sessionID = "ses_transcript_race"
const assistantID = "msg_assistant"
const info: SessionInfo = {
  id: sessionID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  outcome: "succeeded",
  time: { created: 0, updated: 0, idle: 2, viewed: 1 },
  location: { directory: "/project" },
}

function fixture(read: (request: Request) => Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: (input, init) => read(input instanceof Request ? input : new Request(input, init)),
  })
  return createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    emit: (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event })),
    dispose,
  }))
}

const durable = (seq: number) => ({ aggregateID: sessionID, seq, version: 1 as const })

test("a delayed transcript read keeps a live assistant message", async () => {
  const held = Promise.withResolvers<Response>()
  const arrived = Promise.withResolvers<void>()
  let messageGets = 0
  const setup = fixture(async (request) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === `/api/session/${sessionID}`)
      return Response.json({ data: info })
    if (request.method === "GET" && url.pathname === `/api/session/${sessionID}/message`) {
      messageGets++
      if (messageGets === 1) {
        arrived.resolve()
        return held.promise
      }
      return Response.json({ data: [], cursor: {} })
    }
    throw new Error(`Unexpected request: ${request.url}`)
  })

  try {
    setup.data.session.remember(info)
    const reading = setup.data.session.message.sync(sessionID)
    await arrived.promise
    setup.emit({
      id: "evt_started",
      created: 3,
      type: "session.execution.started",
      durable: durable(1),
      data: { sessionID },
    })
    setup.emit({
      id: "evt_step",
      created: 4,
      type: "session.step.started",
      durable: durable(2),
      data: {
        sessionID,
        assistantMessageID: assistantID,
        agent: "build",
        model: { providerID: "provider", id: "model" },
        started: 3,
      },
    })
    setup.emit({
      id: "evt_text_started",
      created: 5,
      type: "session.text.started",
      durable: durable(3),
      data: { sessionID, assistantMessageID: assistantID, ordinal: 0 },
    })
    setup.emit({
      id: "evt_text_delta",
      created: 6,
      type: "session.text.delta",
      data: { sessionID, assistantMessageID: assistantID, ordinal: 0, delta: "Hello" },
    })
    const live = setup.data.session.message.get(sessionID, assistantID)
    expect(live?.type).toBe("assistant")
    if (live?.type === "assistant") {
      expect(live.content[0]?.type).toBe("text")
      if (live.content[0]?.type === "text") expect(live.content[0].text).toBe("Hello")
    }

    held.resolve(
      Response.json({
        data: [{ id: "msg_history", type: "user", text: "Continue", time: { created: 1 } }],
        cursor: {},
      }),
    )
    await reading

    expect(setup.data.session.message.list(sessionID).map((message) => message.id)).toEqual([
      "msg_history",
      assistantID,
    ])

    setup.emit({
      id: "evt_text_ended",
      created: 7,
      type: "session.text.ended",
      durable: durable(4),
      data: { sessionID, assistantMessageID: assistantID, ordinal: 0, text: "Hello world" },
    })
    setup.emit({
      id: "evt_step_ended",
      created: 8,
      type: "session.step.ended",
      durable: durable(5),
      data: {
        sessionID,
        assistantMessageID: assistantID,
        finish: "stop",
        cost: 0,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    setup.emit({
      id: "evt_succeeded",
      created: 9,
      type: "session.execution.succeeded",
      durable: durable(6),
      data: { sessionID },
    })

    expect(setup.data.session.message.list(sessionID).map((message) => message.id)).toEqual([
      "msg_history",
      assistantID,
      "msg_succeeded",
    ])
    expect(setup.data.session.message.get(sessionID, "msg_history")?.type).toBe("user")
    const completed = setup.data.session.message.get(sessionID, assistantID)
    expect(completed?.type).toBe("assistant")
    if (completed?.type === "assistant") {
      expect(completed.finish).toBe("stop")
      expect(completed.content[0]?.type).toBe("text")
      if (completed.content[0]?.type === "text") expect(completed.content[0].text).toBe("Hello world")
    }
    expect(setup.data.session.message.get(sessionID, "msg_succeeded")?.type).toBe("idle")
    expect(messageGets).toBe(1)
  } finally {
    held.resolve(Response.json({ data: [], cursor: {} }))
    setup.dispose()
  }
})
