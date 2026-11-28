import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInboxItem } from "../src/promise"

const sessionID = "ses_undo"
const messageID = "msg_undo"
const undo = { sessionID, messageID }

const item: SessionInboxItem = {
  id: messageID,
  sessionID,
  type: "user",
  delivery: "steer",
  time: { created: 1 },
  payload: { text: "Steer while streaming" },
}

const enqueued: OpenCodeEvent = {
  id: "evt_enqueued",
  type: "session.inbox.enqueued",
  created: 1,
  durable: { aggregateID: sessionID, seq: 1, version: 1 },
  data: {
    sessionID,
    inboxID: messageID,
    item: { type: item.type, delivery: item.delivery, payload: item.payload },
  },
}

function fixture(handler: (request: Request) => Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: (input, init) => handler(input instanceof Request ? input : new Request(input, init)),
  })
  return createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(callback) {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
      },
    }),
    emit: (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event })),
    dispose,
  }))
}

const delivered: OpenCodeEvent = {
  id: "evt_delivered",
  type: "session.inbox.delivered",
  created: 2,
  durable: { aggregateID: sessionID, seq: 2, version: 1 },
  data: { sessionID, inboxID: messageID },
}

const missing = () =>
  Response.json({ _tag: "MessageNotFoundError", message: "Message not found", sessionID, messageID }, { status: 404 })

test("withdraws a queued prompt and skips the revert when the server never materialized it", async () => {
  const calls: string[] = []
  const setup = fixture(async (request) => {
    const url = new URL(request.url)
    calls.push(`${request.method} ${url.pathname}`)
    if (request.method === "GET") return missing()
    if (request.method === "DELETE") return new Response(null, { status: 204 })
    return Response.json({})
  })
  try {
    setup.emit(enqueued)
    expect(setup.data.session.input.has(sessionID, messageID)).toBe(true)
    await setup.data.session.undo(undo)
    expect(calls).toEqual([
      `DELETE /api/session/${sessionID}/inbox/${messageID}`,
      `GET /api/session/${sessionID}/message/${messageID}`,
    ])
  } finally {
    setup.dispose()
  }
})

test("stages a revert when delivery won over the withdraw", async () => {
  const calls: string[] = []
  const setup = fixture(async (request) => {
    const url = new URL(request.url)
    const call = `${request.method} ${url.pathname}`
    calls.push(call)
    if (request.method === "GET")
      return Response.json({ data: { id: messageID, type: "user", text: item.payload.text, time: { created: 1 } } })
    if (request.method === "DELETE") return new Response(null, { status: 204 })
    if (url.pathname.endsWith("/interrupt")) return Response.json({ interrupted: true })
    if (url.pathname.endsWith("/wait")) return new Response(null, { status: 204 })
    if (url.pathname.endsWith("/revert/stage")) return Response.json({ data: { messageID } })
    return Response.json({})
  })
  try {
    await setup.data.session.undo(undo)
    expect(calls).toEqual([
      `DELETE /api/session/${sessionID}/inbox/${messageID}`,
      `GET /api/session/${sessionID}/message/${messageID}`,
      `POST /api/session/${sessionID}/interrupt`,
      `POST /api/experimental/session/${sessionID}/wait`,
      `POST /api/session/${sessionID}/revert/stage`,
    ])
  } finally {
    setup.dispose()
  }
})

test("skips the withdraw when the projection already proves delivery", async () => {
  const calls: string[] = []
  const setup = fixture(async (request) => {
    const url = new URL(request.url)
    calls.push(`${request.method} ${url.pathname}`)
    if (url.pathname.endsWith("/interrupt")) return Response.json({ interrupted: true })
    if (url.pathname.endsWith("/wait")) return new Response(null, { status: 204 })
    if (url.pathname.endsWith("/revert/stage")) return Response.json({ data: { messageID } })
    return Response.json({})
  })
  try {
    setup.emit(enqueued)
    setup.emit(delivered)
    expect(setup.data.session.input.has(sessionID, messageID)).toBe(false)
    expect(setup.data.session.message.get(sessionID, messageID)?.type).toBe("user")
    await setup.data.session.undo(undo)
    expect(calls).toEqual([
      `POST /api/session/${sessionID}/interrupt`,
      `POST /api/experimental/session/${sessionID}/wait`,
      `POST /api/session/${sessionID}/revert/stage`,
    ])
  } finally {
    setup.dispose()
  }
})

test("a queued withdraw waits for a prompt already being admitted", async () => {
  const calls: string[] = []
  const admitted = Promise.withResolvers<Response>()
  const setup = fixture(async (request) => {
    const url = new URL(request.url)
    const call = `${request.method} ${url.pathname}`
    calls.push(call)
    if (call === `POST /api/session/${sessionID}/prompt`) return admitted.promise
    if (request.method === "GET") return missing()
    if (request.method === "DELETE") return new Response(null, { status: 204 })
    return Response.json({})
  })
  try {
    setup.emit(enqueued)
    const sending = setup.data.session.prompt({ sessionID, text: "hello" }).catch(() => undefined)
    const undoing = setup.data.session.undo(undo)
    admitted.resolve(Response.json({ data: item }))
    await Promise.all([sending, undoing])
    expect(calls[0]).toBe(`POST /api/session/${sessionID}/prompt`)
    expect(calls).toContain(`DELETE /api/session/${sessionID}/inbox/${messageID}`)
  } finally {
    admitted.resolve(Response.json({ data: item }))
    setup.dispose()
  }
})
