import { expect, jest, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
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

function fixture(fetch: (request: Request) => Promise<Response>, connection?: CreateDataInput["connection"]) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: (input, init) => fetch(input instanceof Request ? input : new Request(input, init)),
  })
  return createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      connection,
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
    request.method === "GET"
      ? response.promise.then((value) => value.clone())
      : Promise.resolve(Response.json({ data: { id: "msg_admitted" } })),
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

const transcript = {
  data: [{ id: item.id, type: "user", text: "Check the remote preview", time: { created: 2 } }],
  cursor: {},
}

test("a transcript read clears a prompt whose delivery event was missed", async () => {
  const setup = fixture(async (request) =>
    new URL(request.url).pathname.endsWith("/message") ? Response.json(transcript) : Response.json({ data: [] }),
  )
  try {
    setup.emit(enqueued)
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(true)
    await setup.data.session.message.sync(item.sessionID)
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
    expect(setup.data.session.message.get(item.sessionID, item.id)?.time.created).toBe(2)
  } finally {
    setup.dispose()
  }
})

test("an inbox read after the server accepted a prompt settles it when the stream lost its events", async () => {
  const setup = fixture(async (request) => {
    if (request.method === "POST") return Response.json({ data: { id: item.id } })
    if (new URL(request.url).pathname.endsWith("/message")) return Response.json(transcript)
    return Response.json({ data: [] })
  })
  try {
    await setup.data.session.prompt({ sessionID: item.sessionID, id: item.id, text: item.payload.text })
    // The server accepted the prompt, so an inbox read without it proves it left the inbox.
    await setup.data.session.pending.sync(item.sessionID)
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
    // The read also brings the delivered row back from the transcript, in place of the pending one.
    await setup.data.session.message.sync(item.sessionID)
    expect(setup.data.session.message.get(item.sessionID, item.id)?.time.created).toBe(2)
    await setup.data.session.pending.sync(item.sessionID)
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("an inbox read sent before the server accepted a prompt keeps it until a newer read decides", async () => {
  const admission = Promise.withResolvers<Response>()
  const inbox = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()]
  const reads = { count: 0 }
  const setup = fixture((request) => {
    if (request.method === "POST") return admission.promise
    reads.count++
    return inbox[reads.count - 1].promise
  })
  try {
    const sending = setup.data.session.prompt({ sessionID: item.sessionID, id: item.id, text: item.payload.text })
    const reading = setup.data.session.pending.sync(item.sessionID)
    admission.resolve(Response.json({ data: { id: item.id } }))
    await sending
    // This read may predate the admission, so it cannot say the prompt is gone.
    inbox[0].resolve(Response.json({ data: [] }))
    await reading
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(true)
    // A read sent after acceptance decides: the prompt was delivered or cancelled meanwhile.
    await settled()
    expect(reads.count).toBe(2)
    inbox[1].resolve(Response.json({ data: [] }))
    await setup.data.session.pending.sync(item.sessionID)
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
  } finally {
    admission.resolve(Response.json({ data: { id: item.id } }))
    inbox.forEach((read) => read.resolve(Response.json({ data: [] })))
    setup.dispose()
  }
})

const event = (seq: number | undefined, type: string, data: Record<string, unknown>) =>
  ({
    id: `evt_${type}_${seq ?? "live"}`,
    type,
    created: seq ?? 0,
    ...(seq === undefined ? {} : { durable: { aggregateID: item.sessionID, seq, version: 1 } }),
    data: { sessionID: item.sessionID, ...data },
  }) as OpenCodeEvent
const turn = { assistantMessageID: "msg_reply" }
const text = (ordinal: number) => ({ ...turn, ordinal })
const stepStarted = (seq: number) =>
  event(seq, "session.step.started", { ...turn, agent: "build", model: { providerID: "test", id: "test" }, started: 3 })
const reply = (...content: string[]) => ({
  id: "msg_reply",
  type: "assistant",
  agent: "build",
  model: { providerID: "test", id: "test" },
  content: content.map((value) => ({ type: "text", text: value })),
  time: { created: 3 },
})
const page = (seq: number, ...messages: unknown[]) =>
  Response.json({ data: messages.toReversed(), cursor: {}, experimental: { seq } })
const replyText = (setup: ReturnType<typeof fixture>) => {
  const message = setup.data.session.message.get(item.sessionID, "msg_reply")
  return message?.type === "assistant" ? message.content.map((part) => (part.type === "text" ? part.text : "")) : []
}

test("events that arrive during a transcript read apply on top of its page", async () => {
  const read = Promise.withResolvers<Response>()
  const setup = fixture(() => read.promise)
  try {
    setup.emit(enqueued)
    const reading = setup.data.session.message.sync(item.sessionID)
    // The prompt is delivered and its reply starts while the page is on its way.
    setup.emit(event(2, "session.inbox.delivered", { inboxID: item.id }))
    setup.emit(stepStarted(3))
    setup.emit(event(4, "session.text.started", text(0)))
    setup.emit(event(undefined, "session.text.delta", { ...text(0), delta: "Looking" }))
    read.resolve(page(2, transcript.data[0]))
    await reading
    expect(setup.data.session.message.list(item.sessionID).map((message) => message.id)).toEqual([item.id, "msg_reply"])
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
    expect(replyText(setup)).toEqual(["Looking"])
  } finally {
    read.resolve(page(2))
    setup.dispose()
  }
})

test("events a transcript page already reflects do not apply again when the stream delivers them late", async () => {
  const setup = fixture(async () => page(5, transcript.data[0], reply("Hello")))
  try {
    await setup.data.session.message.sync(item.sessionID)
    setup.emit(event(2, "session.inbox.delivered", { inboxID: item.id }))
    setup.emit(stepStarted(3))
    setup.emit(event(4, "session.text.started", text(0)))
    setup.emit(event(undefined, "session.text.delta", { ...text(0), delta: "Hel" }))
    setup.emit(event(5, "session.text.ended", { ...text(0), text: "Hello" }))
    expect(setup.data.session.message.list(item.sessionID).map((message) => message.id)).toEqual([item.id, "msg_reply"])
    expect(replyText(setup)).toEqual(["Hello"])
    // The stream has caught up with the page, so what follows is new.
    setup.emit(event(6, "session.text.started", text(1)))
    setup.emit(event(undefined, "session.text.delta", { ...text(1), delta: "World" }))
    expect(replyText(setup)).toEqual(["Hello", "World"])
  } finally {
    setup.dispose()
  }
})

test("a transcript load that fails is retried until it lands", async () => {
  jest.useFakeTimers()
  const reads: string[] = []
  const setup = fixture(async (request) => {
    const path = new URL(request.url).pathname
    reads.push(path)
    // The inbox answers before the prompt is delivered; the transcript read that would show the delivery fails.
    if (!path.endsWith("/message")) return Response.json({ data: [item] })
    if (reads.filter((read) => read === path).length === 1)
      return Response.json({ _tag: "UnknownError", message: "offline" }, { status: 503 })
    return Response.json(transcript)
  })
  try {
    setup.emit(enqueued)
    const hydrating = setup.data.session.hydrate(item.sessionID)
    await settled()
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(true)
    jest.advanceTimersByTime(500)
    await hydrating
    expect(setup.data.session.input.has(item.sessionID, item.id)).toBe(false)
    expect(setup.data.session.message.get(item.sessionID, item.id)?.time.created).toBe(2)
  } finally {
    jest.useRealTimers()
    setup.dispose()
  }
})

test("a transcript load stops retrying once its owner lets go", async () => {
  jest.useFakeTimers()
  const setup = fixture(async () => Response.json({ _tag: "UnknownError", message: "offline" }, { status: 503 }))
  const controller = new AbortController()
  try {
    const hydrating = setup.data.session.hydrate(item.sessionID, { signal: controller.signal })
    await settled()
    controller.abort()
    await expect(hydrating).rejects.toBeDefined()
  } finally {
    jest.useRealTimers()
    setup.dispose()
  }
})

async function settled() {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve()
}

test("a transcript read that started while the stream was down does not stand in for one after it reconnects", async () => {
  const [status, setStatus] = createSignal<"connected" | "connecting" | "reconnecting">("reconnecting")
  const reads: Array<PromiseWithResolvers<Response>> = []
  const setup = fixture(
    () => {
      const read = Promise.withResolvers<Response>()
      reads.push(read)
      return read.promise
    },
    { status },
  )
  try {
    const early = setup.data.session.message.sync(item.sessionID)
    setStatus("connected")
    const late = setup.data.session.message.sync(item.sessionID)
    // The early page may predate events the stream dropped before it reconnected.
    reads[0].resolve(page(1))
    await early
    await settled()
    expect(reads).toHaveLength(2)
    reads[1].resolve(page(2, transcript.data[0]))
    await late
    expect(setup.data.session.message.get(item.sessionID, item.id)?.time.created).toBe(2)
  } finally {
    reads.forEach((read) => read.resolve(page(2)))
    setup.dispose()
  }
})

test("a transcript read that hangs gives up, so the events it held still apply", async () => {
  jest.useFakeTimers()
  const setup = fixture(
    (request) =>
      new Promise<Response>((_resolve, reject) =>
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }),
      ),
  )
  try {
    const reading = setup.data.session.message.sync(item.sessionID).catch((error: unknown) => error)
    setup.emit(stepStarted(3))
    expect(setup.data.session.message.get(item.sessionID, "msg_reply")).toBeUndefined()
    jest.advanceTimersByTime(30_000)
    expect(await reading).toBeInstanceOf(Error)
    expect(setup.data.session.message.get(item.sessionID, "msg_reply")?.type).toBe("assistant")
  } finally {
    jest.useRealTimers()
    setup.dispose()
  }
})

test("an inbox read that lacks a finished compaction keeps its transcript row", async () => {
  const compaction = "msg_compaction"
  const setup = fixture(async (request) =>
    new URL(request.url).pathname.endsWith("/message")
      ? page(5, {
          id: compaction,
          type: "compaction",
          status: "completed",
          reason: "manual",
          summary: "Summary",
          time: { created: 2 },
        })
      : Response.json({ data: [] }),
  )
  try {
    setup.emit(
      event(1, "session.inbox.enqueued", {
        inboxID: compaction,
        item: { type: "compaction", delivery: "steer", payload: {} },
      }),
    )
    // The stream lost the compaction's start and end; the transcript holds its row under the inbox ID.
    await setup.data.session.message.sync(item.sessionID)
    await setup.data.session.pending.sync(item.sessionID)
    expect(setup.data.session.pending.list(item.sessionID)).toEqual([])
    expect(setup.data.session.message.get(item.sessionID, compaction)?.type).toBe("compaction")
  } finally {
    setup.dispose()
  }
})

test("the echo replaces an optimistic prompt even when a transcript page covers it", async () => {
  const read = Promise.withResolvers<Response>()
  const setup = fixture(async (request) =>
    request.method === "POST" ? Response.json({ data: { id: item.id } }) : read.promise,
  )
  try {
    const reading = setup.data.session.message.sync(item.sessionID)
    await setup.data.session.prompt({ sessionID: item.sessionID, id: item.id, text: "draft" })
    setup.emit(enqueued)
    // The page was read after admission and before delivery, so it holds no row for the prompt.
    read.resolve(page(1))
    await reading
    const row = setup.data.session.message.get(item.sessionID, item.id)
    expect(row?.type === "user" ? row.text : undefined).toBe(item.payload.text)
  } finally {
    read.resolve(page(1))
    setup.dispose()
  }
})
