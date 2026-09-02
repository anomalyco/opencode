import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent, type SessionInboxUser } from "../src/promise"

test("retries transient admission with the same ID and captured body", async () => {
  const bodies: string[] = []
  using fixture = setup(async (request) => {
    bodies.push(await request.text())
    if (bodies.length === 1) return new Response(null, { status: 503 })
    return Response.json({ data: item(JSON.parse(bodies[0]).id) })
  })
  const input = { sessionID, text: "Original", files: [{ uri: "file:///original.txt" }] }
  const sent = fixture.data.session.prompt(input).catch((error: unknown) => error)
  input.text = "Changed"
  input.files[0].uri = "file:///changed.txt"
  await wait(() => bodies.length === 2)
  expect(await sent).toMatchObject({ type: "user" })
  expect(bodies[1]).toBe(bodies[0])
  expect(JSON.parse(bodies[0])).toMatchObject({ text: "Original", files: [{ uri: "file:///original.txt" }] })
  expect(fixture.data.session.message.list(sessionID)).toHaveLength(1)
})

test("retries model selection but runs arbitrary preparation once and preserves admission ordering", async () => {
  const calls: string[] = []
  let modelCalls = 0
  let promptCalls = 0
  using fixture = setup(async (request) => {
    const rpc = request.url.split("/").at(-1)
    const body = await request.json()
    calls.push(rpc === "prompt" ? body.text : rpc)
    if (rpc === "model") {
      modelCalls += 1
      return new Response(null, { status: modelCalls === 1 ? 503 : 204 })
    }
    if (body.text === "First" && ++promptCalls === 1) throw new Error("Connection reset")
    return Response.json({ data: item(body.id) })
  })
  let preparations = 0
  const first = fixture.data.session.prompt({
    sessionID,
    text: "First",
    model: { providerID: "demo", id: "model" },
    prepare: async () => {
      preparations += 1
    },
  })
  const second = fixture.data.session.prompt({ sessionID, text: "Second" })
  await Promise.all([first, second])
  expect(preparations).toBe(1)
  expect(calls).toEqual(["model", "model", "First", "First", "Second"])
})

test.each([400, 401, 404, 409, 422])("does not retry definitive HTTP %i rejection", async (status) => {
  let calls = 0
  using fixture = setup(async () => {
    calls += 1
    return Response.json({ message: "Invalid request" }, { status })
  })
  await expect(fixture.data.session.prompt({ sessionID, text: "Invalid" })).rejects.toBeDefined()
  expect(calls).toBe(1)
  expect(fixture.data.session.pending.list(sessionID)).toEqual([])
})

test("an internal server error is ambiguous and retries the original admission", async () => {
  let calls = 0
  using fixture = setup(async (request) => {
    calls += 1
    if (calls === 1) return new Response(null, { status: 500 })
    return Response.json({ data: item((await request.json()).id) })
  })
  expect(await fixture.data.session.prompt({ sessionID, id: "msg_500", text: "Retry" })).toMatchObject({
    id: "msg_500",
  })
  expect(calls).toBe(2)
})

test("cancelling an existing admission reaches the server even while its local retry is gated", async () => {
  const methods: string[] = []
  using fixture = setup(async (request) => {
    methods.push(request.method)
    return new Response(null, { status: 204 })
  })
  fixture.enqueue("msg_existing")
  const gate = Promise.withResolvers<void>()
  const sent = fixture.data.session
    .prompt({ sessionID, id: "msg_existing", text: "Retry", gate: gate.promise })
    .catch((error: unknown) => error)
  await fixture.data.session.pending.cancel(sessionID, "msg_existing")
  expect(await sent).toMatchObject({ reason: "cancelled" })
  expect(methods).toEqual(["DELETE"])
  gate.resolve()
})

test("keeps an exhausted submission visible and manual retry reuses its identity", async () => {
  const ids: string[] = []
  const models: string[] = []
  using fixture = setup(async (request) => {
    const body = await request.json()
    if (request.url.endsWith("/model")) {
      models.push(body.model.id)
      return new Response(null, { status: 204 })
    }
    ids.push(body.id)
    if (ids.length <= 4) return new Response(null, { status: 502 })
    return Response.json({ data: item(body.id) })
  })
  await expect(
    fixture.data.session.prompt({ sessionID, text: "Keep me", model: { providerID: "demo", id: "original" } }),
  ).rejects.toMatchObject({ reason: "failed" })
  expect(ids).toHaveLength(4)
  expect(fixture.data.session.submission.get(sessionID, ids[0])).toMatchObject({ status: "failed", attempt: 4 })
  expect(fixture.data.session.message.list(sessionID)).toMatchObject([{ id: ids[0], text: "Keep me" }])
  await fixture.api.session.switchModel({ sessionID, model: { providerID: "demo", id: "different" } })
  await fixture.data.session.submission.retry(sessionID, ids[0])
  expect(ids).toHaveLength(5)
  expect(new Set(ids).size).toBe(1)
  expect(models).toEqual(["original", "different", "original"])
  expect(fixture.data.session.submission.get(sessionID, ids[0])).toBeUndefined()
})

test("an enqueue acknowledgement settles a lost response without another POST", async () => {
  const requested = Promise.withResolvers<string>()
  let calls = 0
  using fixture = setup(async (request) => {
    calls += 1
    requested.resolve((await request.json()).id)
    return new Promise((_, reject) =>
      request.signal.addEventListener("abort", () => reject(new Error("Closed")), { once: true }),
    )
  })
  const sent = fixture.data.session.prompt({ sessionID, text: "Accepted" })
  const id = await requested.promise
  fixture.enqueue(id)
  expect(await sent).toEqual(item(id))
  expect(calls).toBe(1)
  expect(fixture.data.session.submission.get(sessionID, id)).toBeUndefined()
})

test("another session can send while one session is retrying", async () => {
  const calls: string[] = []
  using fixture = setup(async (request) => {
    const body = await request.json()
    calls.push(body.text)
    if (body.text === "Blocked") return new Response(null, { status: 503 })
    return Response.json({ data: { ...item(body.id), sessionID: "ses_other" } })
  })
  const first = fixture.data.session
    .prompt({ sessionID, id: "msg_blocked", text: "Blocked" })
    .catch((error: unknown) => error)
  await wait(() => fixture.data.session.submission.get(sessionID, "msg_blocked")?.status === "retrying")
  await fixture.data.session.prompt({ sessionID: "ses_other", text: "Independent" })
  expect(calls).toEqual(["Blocked", "Independent"])
  fixture.dispose()
  expect(await first).toMatchObject({ reason: "cancelled" })
})

test("a projected message acknowledges delivery even when the enqueue event was missed", async () => {
  const requested = Promise.withResolvers<string>()
  using fixture = setup(async (request) => {
    if (request.method === "GET")
      return Response.json({
        data: [
          { id: "msg_answer", type: "assistant", time: { created: 30 }, content: [] },
          { id: await requested.promise, type: "user", text: "Canonical text", time: { created: 25 } },
        ],
        cursor: {},
      })
    requested.resolve((await request.json()).id)
    return new Promise((_, reject) =>
      request.signal.addEventListener("abort", () => reject(new Error("Closed")), { once: true }),
    )
  })
  const sent = fixture.data.session.prompt({ sessionID, text: "Original text" })
  await requested.promise
  await fixture.data.session.message.sync(sessionID)
  expect(await sent).toMatchObject({ payload: { text: "Canonical text" }, timeCreated: 25 })
  expect(fixture.data.session.submission.get(sessionID, await requested.promise)).toBeUndefined()
  fixture.emit({
    id: "evt_delivered",
    created: 25,
    type: "session.inbox.delivered",
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    data: { sessionID, inboxID: await requested.promise, messageID: await requested.promise },
  })
  expect(fixture.data.session.input.list(sessionID)).toEqual([])
  expect(fixture.data.session.pending.list(sessionID)).toEqual([])
  expect(fixture.data.session.message.list(sessionID).map((row) => row.id)).toEqual([
    await requested.promise,
    "msg_answer",
  ])
  fixture.data.session.evict(sessionID)
  expect(fixture.data.session.message.list(sessionID)).toEqual([])
})

test("delivery without an enqueue echo confirms canonical content rather than the optimistic placeholder", async () => {
  const requested = Promise.withResolvers<string>()
  using fixture = setup(async (request) => {
    if (request.method === "GET")
      return Response.json({
        data: { id: await requested.promise, type: "user", text: "Canonical text", time: { created: 25 } },
      })
    requested.resolve((await request.json()).id)
    return new Promise((_, reject) =>
      request.signal.addEventListener("abort", () => reject(new Error("Closed")), { once: true }),
    )
  })
  const sent = fixture.data.session.prompt({ sessionID, text: "Original text" })
  const id = await requested.promise
  fixture.emit({
    id: "evt_delivered",
    created: 25,
    type: "session.inbox.delivered",
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    data: { sessionID, inboxID: id, messageID: id },
  })
  expect(await sent).toMatchObject({ payload: { text: "Canonical text" }, timeCreated: 25 })
  expect(fixture.data.session.pending.list(sessionID)).toEqual([])
})

test("a cancellation echo stops retries without resurrecting the prompt", async () => {
  let calls = 0
  using fixture = setup(async () => {
    calls += 1
    return new Response(null, { status: 503 })
  })
  const sent = fixture.data.session
    .prompt({ sessionID, id: "msg_cancelled", text: "Cancel" })
    .catch((error: unknown) => error)
  await wait(() => fixture.data.session.submission.get(sessionID, "msg_cancelled")?.status === "retrying")
  fixture.emit({
    id: "evt_cancel",
    created: 20,
    type: "session.inbox.cancelled",
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    data: { sessionID, inboxID: "msg_cancelled" },
  })
  expect(await sent).toMatchObject({ reason: "cancelled" })
  expect(fixture.data.session.message.list(sessionID)).toEqual([])
  expect(calls).toBe(1)
})

test("does not retry arbitrary preparation callbacks", async () => {
  let calls = 0
  using fixture = setup(async () => {
    calls += 1
    return new Response(null, { status: 503 })
  })
  let prepared = 0
  await expect(
    fixture.data.session.prompt({
      sessionID,
      text: "Prepare",
      prepare: async () => {
        prepared += 1
        throw new Error("Preparation failed")
      },
    }),
  ).rejects.toThrow("Preparation failed")
  expect(prepared).toBe(1)
  expect(calls).toBe(0)
})

test("cancellation interrupts backoff and releases a following submission", async () => {
  const calls: string[] = []
  using fixture = setup(async (request) => {
    if (request.method === "DELETE") return new Response(null, { status: 204 })
    const body = await request.json()
    calls.push(body.text)
    if (body.text === "Cancel me") return new Response(null, { status: 503 })
    return Response.json({ data: item(body.id) })
  })
  const first = fixture.data.session
    .prompt({ sessionID, id: "msg_cancel", text: "Cancel me" })
    .catch((error: unknown) => error)
  const second = fixture.data.session.prompt({ sessionID, text: "Next" })
  await wait(() => fixture.data.session.submission.get(sessionID, "msg_cancel")?.status === "retrying")
  await fixture.data.session.pending.cancel(sessionID, "msg_cancel")
  expect(await first).toMatchObject({ reason: "cancelled" })
  await second
  expect(calls).toEqual(["Cancel me", "Next"])
})

test("disposal stops a prompt waiting behind a gate without sending it", async () => {
  let calls = 0
  using fixture = setup(async () => {
    calls += 1
    return Response.json({ data: item("msg_disposed") })
  })
  const gate = Promise.withResolvers<void>()
  const sent = fixture.data.session
    .prompt({ sessionID, text: "Never send", gate: gate.promise })
    .catch((error: unknown) => error)
  fixture.dispose()
  expect(await sent).toMatchObject({ reason: "cancelled" })
  gate.resolve()
  await Bun.sleep(10)
  expect(calls).toBe(0)
})

test("diagnostics exclude prompt data and raw error messages", async () => {
  let calls = 0
  using fixture = setup(async (request) => {
    calls += 1
    if (calls === 1) throw new Error("private transport details")
    return Response.json({ data: item((await request.json()).id) })
  })
  await fixture.data.session.prompt({ sessionID, text: "private prompt", metadata: { private: "private metadata" } })
  expect(fixture.logs).toContainEqual(expect.objectContaining({ stage: "prompt", outcome: "retrying", attempt: 1 }))
  expect(fixture.logs).toContainEqual(expect.objectContaining({ stage: "prompt", outcome: "accepted", attempt: 2 }))
  expect(JSON.stringify(fixture.logs)).not.toContain("private")
})

const sessionID = "ses_retry"
const item = (id: string): SessionInboxUser => ({
  id,
  sessionID,
  type: "user",
  payload: { text: "Accepted" },
  delivery: "steer",
  timeCreated: 10,
})

function setup(handle: (request: Request) => Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const logs: Readonly<Record<string, unknown>>[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => handle(input instanceof Request ? input : new Request(input, init)),
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
      log: {
        info: (_message, data) => {
          if (data) logs.push(data)
        },
      },
    }),
    dispose,
  }))
  const emit = (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details }))
  return {
    data: root.data,
    api,
    dispose: root.dispose,
    [Symbol.dispose]: root.dispose,
    logs,
    emit,
    enqueue(id: string) {
      emit({
        id: "evt_enqueue",
        created: 10,
        type: "session.inbox.enqueued",
        durable: { aggregateID: sessionID, seq: 1, version: 1 },
        data: { sessionID, inboxID: id, item: { type: "user", payload: { text: "Accepted" }, delivery: "steer" } },
      })
    },
  }
}

async function wait(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("Timed out waiting for submission")
}
