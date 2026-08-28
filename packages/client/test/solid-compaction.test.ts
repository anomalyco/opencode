import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInboxCompaction } from "../src/promise"

test("admits compaction before model setup and serializes the following prompt", async () => {
  using fixture = setup()
  const compact = fixture.data.session.compact({ sessionID, model: { providerID: "demo", id: "model" } })
  const proposed = fixture.data.session.pending.list(sessionID)[0]
  expect(proposed).toMatchObject({ type: "compaction", sessionID })
  expect(fixture.calls).toEqual([])
  expect(fixture.data.session.message.list(sessionID)).toEqual([])
  expect(fixture.data.session.status(sessionID)).toBe("idle")

  const prompt = fixture.data.session.prompt({ sessionID, text: "Follow up" })
  expect(fixture.data.session.message.list(sessionID)).toMatchObject([{ type: "user", text: "Follow up" }])
  await wait(() => fixture.calls.length === 1)
  expect(fixture.calls).toEqual(["model"])
  fixture.model.resolve()
  await wait(() => fixture.calls.length === 2)
  expect(fixture.calls).toEqual(["model", "compact"])
  fixture.response.resolve(Response.json({ data: item(proposed.id) }))
  await Promise.all([compact, prompt])
  expect(fixture.calls).toEqual(["model", "compact", "prompt"])
  expect(fixture.proposals).toEqual([proposed.id])
})

test("coalesces duplicate gestures until the admission request settles", async () => {
  using fixture = setup()
  const first = fixture.data.session.compact({ sessionID })
  expect(fixture.data.session.compact({ sessionID })).toBe(first)
  expect(fixture.data.session.pending.list(sessionID)).toHaveLength(1)
  await wait(() => fixture.calls.length === 1)
  fixture.response.resolve(Response.json({ data: item("msg_canonical") }))
  await first
  expect(fixture.calls).toEqual(["compact"])
  const next = fixture.data.session.compact({ sessionID })
  expect(next).not.toBe(first)
  await next
  expect(fixture.calls).toEqual(["compact", "compact"])
})

test("substitutes the canonical response ID and reconciles its later echo", async () => {
  using fixture = setup()
  const request = fixture.data.session.compact({ sessionID })
  const proposed = fixture.data.session.pending.list(sessionID)[0].id
  await fixture.data.session.pending.sync(sessionID)
  expect(fixture.data.session.pending.list(sessionID).map((row) => row.id)).toEqual([proposed])
  fixture.response.resolve(Response.json({ data: item("msg_canonical") }))
  await request
  expect(fixture.data.session.pending.list(sessionID)).toEqual([item("msg_canonical")])
  fixture.enqueue("msg_canonical", 20)
  expect(fixture.data.session.pending.list(sessionID)).toEqual([item("msg_canonical", 20)])
  expect(fixture.data.session.input.list(sessionID)).toEqual([])
})

test.each(["proposed", "canonical"])("adopts the %s echo before the response without duplicating it", async (kind) => {
  using fixture = setup()
  const request = fixture.data.session.compact({ sessionID })
  const id = kind === "proposed" ? fixture.data.session.pending.list(sessionID)[0].id : "msg_canonical"
  fixture.enqueue(id, 20)
  expect(fixture.data.session.pending.list(sessionID)).toEqual([item(id, 20)])
  fixture.response.resolve(Response.json({ data: item(id) }))
  await request
  expect(fixture.data.session.pending.list(sessionID)).toEqual([item(id, 20)])
})

test.each(["started", "cancelled", "failed"])(
  "does not resurrect a canonical item already %s before the response",
  async (kind) => {
    using fixture = setup()
    const request = fixture.data.session.compact({ sessionID })
    fixture.enqueue("msg_canonical")
    if (kind === "started")
      fixture.emit({
        ...event,
        type: "session.compaction.started",
        data: { sessionID, inputID: "msg_canonical", reason: "manual" },
      })
    if (kind === "cancelled")
      fixture.emit({ ...event, type: "session.inbox.cancelled", data: { sessionID, inboxID: "msg_canonical" } })
    if (kind === "failed")
      fixture.emit({
        ...event,
        type: "session.compaction.failed",
        data: {
          sessionID,
          inputID: "msg_canonical",
          reason: "manual",
          error: { type: "aborted", message: "Cancelled" },
        },
      })
    expect(fixture.data.session.pending.list(sessionID)).toEqual([])
    fixture.response.resolve(Response.json({ data: item("msg_canonical") }))
    await request
    expect(fixture.data.session.pending.list(sessionID)).toEqual([])
    if (kind === "started") {
      expect(fixture.data.session.message.list(sessionID)).toMatchObject([{ type: "compaction", status: "running" }])
      fixture.emit({
        ...event,
        type: "session.compaction.ended",
        data: { sessionID, reason: "manual", text: "Summary", recent: "Recent" },
      })
      expect(fixture.data.session.message.list(sessionID)).toMatchObject([
        { type: "compaction", status: "completed", summary: "Summary" },
      ])
    }
  },
)

test.each(["model", "compact"])("rolls back a rejected %s RPC and releases the following prompt", async (rpc) => {
  using fixture = setup()
  const request = fixture.data.session.compact({ sessionID, model: { providerID: "demo", id: "model" } })
  const failed = request.catch((error: unknown) => error)
  const prompt = fixture.data.session.prompt({ sessionID, text: "Follow up" })
  if (rpc === "model") fixture.model.reject(new Error("Model setup failed"))
  if (rpc === "compact") {
    fixture.model.resolve()
    fixture.response.resolve(new Response("Admission failed", { status: 500 }))
  }
  expect(await failed).toBeInstanceOf(Error)
  await prompt
  expect(fixture.data.session.pending.list(sessionID).map((row) => row.type)).toEqual(["user"])
  expect(fixture.data.session.message.list(sessionID)).toMatchObject([{ type: "user", text: "Follow up" }])
})

test.each(["proposed", "canonical", "existing"])(
  "preserves acknowledged %s compaction after an HTTP error",
  async (kind) => {
    using fixture = setup()
    if (kind === "existing") fixture.enqueue("msg_canonical")
    const request = fixture.data.session.compact({ sessionID })
    const failed = request.catch((error: unknown) => error)
    const id = kind === "proposed" ? fixture.data.session.pending.list(sessionID)[0].id : "msg_canonical"
    if (kind !== "existing") fixture.enqueue(id)
    expect(fixture.data.session.pending.list(sessionID)).toEqual([item(id)])
    fixture.response.resolve(new Response("Lost response", { status: 500 }))
    expect(await failed).toBeInstanceOf(Error)
    expect(fixture.data.session.pending.list(sessionID)).toEqual([item(id)])
    expect(fixture.listeners.size).toBe(1)
  },
)

const sessionID = "ses_compact"
const event = { id: "evt_compact", created: 10, durable: { aggregateID: sessionID, seq: 1, version: 1 } }
const item = (id: string, timeCreated = 10): SessionInboxCompaction => ({
  id,
  sessionID,
  timeCreated,
  type: "compaction",
  delivery: "steer",
  payload: {},
})

function setup() {
  const model = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  const calls: string[] = []
  const proposals: string[] = []
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const rpc = new URL(request.url).pathname.split("/").at(-1)
      if (rpc === "inbox") return Response.json({ data: [] })
      if (rpc === "model") {
        calls.push(rpc)
        await model.promise
        return new Response(null, { status: 204 })
      }
      if (rpc === "compact") {
        calls.push(rpc)
        proposals.push((await request.json()).id)
        return (await response.promise).clone()
      }
      if (rpc === "prompt") {
        calls.push(rpc)
        return Response.json({
          data: { ...item((await request.json()).id), type: "user", payload: { text: "Follow up" } },
        })
      }
      throw new Error(`Unexpected request: ${request.url}`)
    },
  })
  const root = createRoot((dispose) => ({
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
    dispose,
  }))
  const emit = (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details }))
  return {
    data: root.data,
    [Symbol.dispose]: root.dispose,
    model,
    response,
    calls,
    proposals,
    listeners,
    emit,
    enqueue(id: string, created = 10) {
      emit({
        ...event,
        created,
        type: "session.inbox.enqueued",
        data: { sessionID, inboxID: id, item: { type: "compaction", delivery: "steer", payload: {} } },
      })
    },
  }
}

async function wait(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("Timed out waiting for request")
}
