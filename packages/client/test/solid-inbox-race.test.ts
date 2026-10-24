import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInboxItem } from "../src/promise"

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

test("a delivered message confirmed by its listing drops the pending row", async () => {
  const inbox = Promise.withResolvers<Response>()
  const messages = Promise.withResolvers<Response>()
  const admission = Promise.withResolvers<Response>()
  const setup = fixture((request) => {
    if (request.method === "GET") return request.url.includes("/message") ? messages.promise : inbox.promise
    return admission.promise
  })
  try {
    const sending = setup.data.session.prompt({
      sessionID: item.sessionID,
      id: "msg_image",
      text: "Check the screenshot",
    })
    admission.resolve(Response.json({ data: { id: "msg_image" } }))
    await sending
    // The echoes were lost across a stream drop. The inbox read alone cannot
    // tell the consumed row from one whose projection lags, so it stays
    // queued — the same invariant that protects a prompt racing its echo.
    const reading = setup.data.session.pending.sync(item.sessionID)
    inbox.resolve(Response.json({ data: [] }))
    await reading
    expect(setup.data.session.input.has(item.sessionID, "msg_image")).toBe(true)
    // The message listing is the proof of delivery: the projection inserts
    // the message in the same transaction that consumes the inbox row.
    const listing = setup.data.session.message.sync(item.sessionID)
    messages.resolve(
      Response.json({
        data: [{ id: "msg_image", type: "user", time: { created: 1 }, text: "Check the screenshot" }],
        cursor: {},
      }),
    )
    await listing
    expect(setup.data.session.input.has(item.sessionID, "msg_image")).toBe(false)
    expect(setup.data.session.message.get(item.sessionID, "msg_image")?.id).toBe("msg_image")
  } finally {
    inbox.resolve(Response.json({ data: [] }))
    messages.resolve(Response.json({ data: [], cursor: {} }))
    admission.resolve(Response.json({ data: { id: "msg_image" } }))
    setup.dispose()
  }
})

test("discard drops a row a successful cancel consumed", async () => {
  const inbox = Promise.withResolvers<Response>()
  const admission = Promise.withResolvers<Response>()
  const setup = fixture((request) => (request.method === "GET" ? inbox.promise : admission.promise))
  try {
    const sending = setup.data.session.prompt({
      sessionID: item.sessionID,
      id: "msg_stale",
      text: "Check the screenshot",
    })
    admission.resolve(Response.json({ data: { id: "msg_stale" } }))
    await sending
    expect(setup.data.session.input.has(item.sessionID, "msg_stale")).toBe(true)
    // The cancel succeeded (a missing row is a no-op), so the row is consumed
    // even if its echo is lost.
    setup.data.session.pending.discard(item.sessionID, "msg_stale")
    expect(setup.data.session.input.has(item.sessionID, "msg_stale")).toBe(false)
    const reading = setup.data.session.pending.sync(item.sessionID)
    inbox.resolve(Response.json({ data: [] }))
    await reading
    expect(setup.data.session.input.has(item.sessionID, "msg_stale")).toBe(false)
  } finally {
    inbox.resolve(Response.json({ data: [] }))
    admission.resolve(Response.json({ data: { id: "msg_stale" } }))
    setup.dispose()
  }
})

test("release lets a fresh read settle a conflicted row", async () => {
  const snapshots = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()]
  const admission = Promise.withResolvers<Response>()
  let reads = 0
  const setup = fixture((request) => {
    if (request.method !== "GET") return admission.promise
    if (!request.url.includes("/inbox")) return Promise.resolve(Response.json({ data: [] }))
    return snapshots[reads++].promise
  })
  try {
    const sending = setup.data.session.prompt({
      sessionID: item.sessionID,
      id: "msg_conflict",
      text: "Check the screenshot",
    })
    admission.resolve(Response.json({ data: { id: "msg_conflict" } }))
    await sending
    // The mutation conflicted, but that does not prove the row consumed: a
    // lost delivery-change echo can make a re-click a rejected no-op. The
    // released guard lets the read decide.
    setup.data.session.pending.release("msg_conflict")
    const reading = setup.data.session.pending.sync(item.sessionID)
    snapshots[0].resolve(
      Response.json({ data: [{ ...item, id: "msg_conflict", payload: { text: "Check the screenshot" } }] }),
    )
    await reading
    expect(setup.data.session.input.has(item.sessionID, "msg_conflict")).toBe(true)
    // Once a later read comes back without the row, the released guard lets it
    // clear.
    setup.data.session.pending.invalidate(item.sessionID)
    setup.data.session.pending.release("msg_conflict")
    const rereading = setup.data.session.pending.sync(item.sessionID)
    snapshots[1].resolve(Response.json({ data: [] }))
    await rereading
    expect(setup.data.session.input.has(item.sessionID, "msg_conflict")).toBe(false)
  } finally {
    snapshots.forEach((snapshot) => snapshot.resolve(Response.json({ data: [] })))
    admission.resolve(Response.json({ data: { id: "msg_conflict" } }))
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
