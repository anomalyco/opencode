import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInboxItem, type SessionInfo } from "../src/promise"

const item: SessionInboxItem = {
  id: "msg_remote",
  sessionID: "ses_remote",
  type: "user",
  delivery: "steer",
  time: { created: 1 },
  payload: { text: "Check the remote preview" },
}

function fixture(fetch: (request: Request) => Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: (input, init) => fetch(input instanceof Request ? input : new Request(input, init)),
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

const enqueued: OpenCodeEvent = {
  id: "evt_enqueued",
  type: "session.inbox.enqueued",
  created: 1,
  durable: { aggregateID: item.sessionID, seq: 1, version: 1 },
  data: {
    sessionID: item.sessionID,
    inboxID: item.id,
    item: { type: item.type, delivery: item.delivery, payload: item.payload },
  },
}

test.each(["delivered", "cancelled"] as const)(
  "a delayed inbox snapshot cannot resurrect a %s prompt",
  async (action) => {
    const response = Promise.withResolvers<Response>()
    const setup = fixture(() => response.promise)
    try {
      setup.emit(enqueued)
      const reading = setup.data.session.pending.sync(item.sessionID)
      setup.emit({
        id: "evt_consumed",
        type: `session.inbox.${action}`,
        created: 2,
        durable: { aggregateID: item.sessionID, seq: 2, version: 1 },
        data: { sessionID: item.sessionID, inboxID: item.id },
      })
      expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
      response.resolve(Response.json({ data: [item] }))
      await reading
      expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
      const message = setup.data.session.message.get(item.sessionID, item.id)
      if (action === "cancelled") expect(message).toBeUndefined()
      else expect(message?.time.created).toBe(2)
    } finally {
      response.resolve(Response.json({ data: [] }))
      setup.dispose()
    }
  },
)

test.each(["enqueue", "delivery"] as const)("inbox hydration retains a concurrent %s event", async (action) => {
  const response = Promise.withResolvers<Response>()
  const setup = fixture(() => response.promise)
  try {
    const reading = setup.data.session.pending.sync(item.sessionID)
    setup.emit(
      action === "enqueue"
        ? enqueued
        : {
            id: "evt_delivery",
            type: "session.inbox.delivery.changed",
            created: 2,
            durable: { aggregateID: item.sessionID, seq: 2, version: 1 },
            data: { sessionID: item.sessionID, inboxID: item.id, delivery: "steer" },
          },
    )
    response.resolve(Response.json({ data: action === "enqueue" ? [] : [{ ...item, delivery: "queue" }] }))
    await reading
    expect(setup.data.session.pending.list(item.sessionID)).toEqual([item])
  } finally {
    response.resolve(Response.json({ data: [] }))
    setup.dispose()
  }
})

test("hydration preserves submission order across optimistic admissions", async () => {
  const response = Promise.withResolvers<Response>()
  const gate = Promise.withResolvers<void>()
  const setup = fixture((request) =>
    request.method === "GET" ? response.promise : Promise.resolve(Response.json({ data: { id: "msg_admitted" } })),
  )
  try {
    const first = setup.data.session.prompt({
      sessionID: item.sessionID,
      id: "msg_first",
      text: "First",
      gate: gate.promise,
    })
    const reading = setup.data.session.pending.sync(item.sessionID)
    const second = setup.data.session.prompt({
      sessionID: item.sessionID,
      id: "msg_second",
      text: "Second",
      gate: gate.promise,
    })
    response.resolve(Response.json({ data: [] }))
    await reading
    expect(setup.data.session.input.list(item.sessionID)).toEqual(["msg_first", "msg_second"])
    gate.resolve()
    await Promise.all([first, second])
  } finally {
    response.resolve(Response.json({ data: [] }))
    gate.resolve()
    setup.dispose()
  }
})

test("hydration coalesces a concurrent optimistic compaction even if its POST fails", async () => {
  const response = Promise.withResolvers<Response>()
  const admission = Promise.withResolvers<Response>()
  const setup = fixture((request) => (request.method === "GET" ? response.promise : admission.promise))
  const canonical: SessionInboxItem = {
    id: "msg_canonical",
    sessionID: item.sessionID,
    type: "compaction",
    delivery: "steer",
    time: { created: 1 },
    payload: {},
  }
  try {
    const reading = setup.data.session.pending.sync(item.sessionID)
    const compacting = setup.data.session.compact({ sessionID: item.sessionID }).catch(() => undefined)
    response.resolve(Response.json({ data: [canonical] }))
    await reading
    expect(setup.data.session.pending.list(item.sessionID)).toEqual([canonical])
    admission.reject(new Error("Connection closed"))
    await compacting
    expect(setup.data.session.pending.list(item.sessionID)).toEqual([canonical])
  } finally {
    response.resolve(Response.json({ data: [] }))
    admission.resolve(new Response(null, { status: 204 }))
    setup.dispose()
  }
})

const sessionInfo: SessionInfo = {
  id: item.sessionID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  outcome: "succeeded",
  time: { created: 0, updated: 0, idle: 2, viewed: 1 },
  location: { directory: "/project" },
}

let messageEventSeq = 0
function messageEvent<Type extends OpenCodeEvent["type"]>(
  type: Type,
  data: Extract<OpenCodeEvent, { type: Type }>["data"],
): Extract<OpenCodeEvent, { type: Type }> {
  messageEventSeq++
  return {
    id: `evt_live_${messageEventSeq}`,
    created: 10 + messageEventSeq,
    type,
    durable: { aggregateID: item.sessionID, seq: messageEventSeq, version: 1 },
    data,
  }
}

function messageFixture() {
  const response = Promise.withResolvers<Response>()
  let messageGets = 0
  const setup = fixture((request) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname.includes("/message")) {
      messageGets++
      return messageGets === 1 ? response.promise : Promise.resolve(Response.json({ data: [], cursor: {} }))
    }
    if (request.method === "GET") return Promise.resolve(Response.json({ data: sessionInfo }))
    return Promise.resolve(Response.json({ data: {} }))
  })
  return { ...setup, response, messageGets: () => messageGets }
}

const history = { id: "msg_history", type: "user" as const, text: "Continue", time: { created: 1 } }

function startingAssistant() {
  return [
    messageEvent("session.execution.started", { sessionID: item.sessionID }),
    messageEvent("session.step.started", {
      sessionID: item.sessionID,
      assistantMessageID: "msg_assistant",
      agent: "build",
      model: { providerID: "audit", id: "fixture" },
      started: 3,
    }),
    messageEvent("session.text.started", { sessionID: item.sessionID, assistantMessageID: "msg_assistant", ordinal: 0 }),
    messageEvent("session.text.delta", {
      sessionID: item.sessionID,
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      delta: "Hello",
    }),
  ]
}

function finishAssistant() {
  return [
    messageEvent("session.text.ended", {
      sessionID: item.sessionID,
      assistantMessageID: "msg_assistant",
      ordinal: 0,
      text: "Hello world",
    }),
    messageEvent("session.step.ended", {
      sessionID: item.sessionID,
      assistantMessageID: "msg_assistant",
      finish: "stop",
      cost: 0,
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    }),
    messageEvent("session.execution.succeeded", { sessionID: item.sessionID }),
  ]
}

test("a delayed transcript read keeps the live assistant message (#56725)", async () => {
  const setup = messageFixture()
  try {
    setup.data.session.remember(sessionInfo)
    const reading = setup.data.session.message.sync(item.sessionID)
    startingAssistant().forEach(setup.emit)
    expect(setup.data.session.message.get(item.sessionID, "msg_assistant")).toBeDefined()

    setup.response.resolve(Response.json({ data: [history], cursor: {} }))
    await reading
    finishAssistant().forEach(setup.emit)

    const assistant = setup.data.session.message.get(item.sessionID, "msg_assistant")
    expect(assistant?.type).toBe("assistant")
    if (assistant?.type === "assistant") {
      expect(assistant.content[0]).toMatchObject({ type: "text", text: "Hello world" })
      expect(assistant.finish).toBe("stop")
    }
    expect(setup.data.session.message.list(item.sessionID).map((message) => message.id)).toContain("msg_history")
    expect(setup.messageGets()).toBe(1)
  } finally {
    setup.response.resolve(Response.json({ data: [], cursor: {} }))
    setup.dispose()
  }
})
